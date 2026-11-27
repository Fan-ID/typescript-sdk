# Emulator breakdown and engagement exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /v1/campaigns/:id/metrics/breakdown/export` and `.../engagement/export` to the API emulator, returning JSONL derived from the metrics set with `set_metrics`.

**Architecture:** A new `src/emulator/exports.ts` holds pure helpers (split, window parsing, cells) and two row builders that read `store.buildOverview(campaign)`. `EmulatorResponse` gains optional `text` and `headers` so `dispatch` and `listen` can return JSONL. `dispatch.ts` gets two routes. No stored state changes.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest, MSW is not used for emulator tests, Changesets.

**Spec:** `docs/superpowers/specs/2026-11-27-emulator-breakdown-engagement-exports-design.md`

## Global Constraints

- Public repo: no customer, partner or internal-consumer names in code, docs, tests or the changeset.
- Imports use the `.js` suffix. Run `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` before the final task ends.
- Countries are the fixed list `DE`, `GB`, `US` (sorted, because the spec sorts rows by `country_code`).
- Active days: `cycleDay` days ending today (UTC), oldest first. Status `creating` has no cells.
- Split once across all `(day, country)` cells, then filter by window. Remainders go to the earliest cells.
- Breakdown rows: schema `1.1`. Engagement rows: schema `1.0`.
- Response headers on success: `Content-Type: application/x-ndjson`, `X-Row-Count: <n>`. Errors stay the JSON envelope.
- Errors: bad date or range over 90 days (inclusive span) or bad `engagementContext` → `400 invalid_query_parameter`; `endDate` before `startDate` → `400 invalid_date_range`; unknown campaign → `404 campaign_not_found` (checked before the query).
- Defaults: `endDate` = today UTC, `startDate` = `endDate - 89 days`. A future `endDate` is allowed.
- Commit messages follow commitlint: `feat(emulator): ...`, `test(emulator): ...`, `docs(emulator): ...`.

## Review Focus

- Zero metrics (`listeners: 0`, `streams: 0`, spend `0`): no `NaN`/`Infinity`, so no `null` where the schema is a number.
- Totals smaller than the cell count (for example `listeners: 2` over 12 cells): later cells are `0` and the sums stay exact.
- Only `startDate` or only `endDate` given.
- Window boundary: a span of 90 days is accepted, 91 is rejected with `invalid_query_parameter`.
- Playlist campaign: context is `playlist`, and `engagementContext=catalog` returns an empty 200 with `X-Row-Count: 0`.

---

## File Structure

| File                                                              | Responsibility                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/emulator/exports.ts` (new)                                   | Split helpers, window parsing, active cells, `buildBreakdownRows`, `buildEngagementRows` |
| `src/emulator/dispatch.ts`                                        | `text`/`headers` on `EmulatorResponse`, two routes, `jsonlResponse` helper               |
| `src/emulator/server.ts`                                          | Write `text` and `headers` when present                                                  |
| `tests/emulator/export-helpers.test.ts` (new)                     | Unit tests for the pure helpers                                                          |
| `tests/emulator/campaign-exports.test.ts` (new)                   | Route tests via `dispatch` and SDK `collect` via `listen`                                |
| `docs/api-emulator.md`, `.changeset/emulator-campaign-exports.md` | Docs and release note                                                                    |

---

### Task 1: Pure helpers in `exports.ts`

**Files:**

- Create: `src/emulator/exports.ts`
- Test: `tests/emulator/export-helpers.test.ts`

**Interfaces:**

- Produces:
  - `export const EXPORT_COUNTRIES: readonly ['DE', 'GB', 'US']`
  - `export const EXPORT_MAX_RANGE_DAYS = 90`
  - `export function splitInt(total: number, parts: number): number[]` — floor division, remainder `+1` to the first cells; length `parts`; sums to `total`.
  - `export function splitCents(totalUsd: number, parts: number): number[]` — `splitInt(Math.round(totalUsd * 100), parts)` mapped to dollars.
  - `export interface ExportWindow { startDate: string; endDate: string }`
  - `export type WindowResult = { ok: true; value: ExportWindow } | { ok: false; code: 'invalid_query_parameter' | 'invalid_date_range'; message: string }`
  - `export function parseExportWindow(startDate: string | null, endDate: string | null, today: Date): WindowResult`
  - `export interface ExportCell { reportDate: string; countryCode: string }`
  - `export function buildActiveCells(input: { status: CampaignStatus; cycleDay: number }, today: Date): ExportCell[]` — ordered by `reportDate` asc then `countryCode`; `[]` when status is `creating`.

- [ ] **Step 1: Write the failing tests** in `tests/emulator/export-helpers.test.ts`. Use a fixed `today = new Date('2026-11-27T10:00:00Z')`.
  - `splitInt(10, 3)` equals `[4, 3, 3]`; `splitInt(2, 3)` equals `[1, 1, 0]`; `splitInt(0, 3)` equals `[0, 0, 0]`.
  - `splitCents(10.01, 3)` equals `[3.34, 3.34, 3.33]`.
  - `parseExportWindow(null, null, today)` is `{ ok: true, value: { startDate: '2026-08-30', endDate: '2026-11-27' } }`.
  - Only `startDate` `'2026-11-20'` → `endDate` `'2026-11-27'`. Only `endDate` `'2026-11-10'` → `startDate` `'2026-08-13'`.
  - A 90-day span (`'2026-08-30'` to `'2026-11-27'`) is ok; `'2026-08-29'` to `'2026-11-27'` gives code `invalid_query_parameter`.
  - `endDate` before `startDate` gives `invalid_date_range`. `'2026-02-30'` and `'nope'` give `invalid_query_parameter`. A future `endDate` (`'2026-12-31'`, no start) is ok.
  - `buildActiveCells({ status: 'active', cycleDay: 2 }, today)` has 6 cells: dates `2026-11-26` ×3 then `2026-11-27` ×3, countries `DE, GB, US` in each. Status `creating` returns `[]`.

- [ ] **Step 2: Run** `npx vitest run tests/emulator/export-helpers.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement the signatures above in `src/emulator/exports.ts`.** Date math in UTC with `Date.UTC` and `toISOString().slice(0, 10)`; validate dates with the same round-trip check as `isIsoDate` in `dispatch.ts` (move nothing; re-implement locally or export it from `exports.ts` and import it in `dispatch.ts`, your choice).

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/emulator/exports.ts tests/emulator/export-helpers.test.ts
git commit -m "feat(emulator): add export split, window and cell helpers"
```

---

### Task 2: JSONL plumbing and the breakdown route

**Files:**

- Modify: `src/emulator/exports.ts` (add `buildBreakdownRows`)
- Modify: `src/emulator/dispatch.ts:32-37` (`EmulatorResponse`), route block near the creatives routes (~line 430-440)
- Modify: `src/emulator/server.ts:112-117`
- Test: `tests/emulator/campaign-exports.test.ts`

**Interfaces:**

- Consumes: Task 1 helpers; `store.buildOverview(campaign)`, `store.feeRate`, `store.organizationId`.
- Produces:
  - `EmulatorResponse` gains `text?: string` and `headers?: Record<string, string>`. Responses with `text` set use `json: null`.
  - `export function buildBreakdownRows(store: EmulatorStore, campaign: EmulatorCampaignRecord, window: ExportWindow, now: Date): BreakdownRow[]`
  - In `dispatch.ts`: `function jsonlResponse(rows: unknown[]): EmulatorResponse` → status 200, `text` = one `JSON.stringify(row)` + `\n` per row (empty string when none), headers `Content-Type: application/x-ndjson` and `X-Row-Count: String(rows.length)`.

Row rules for `buildBreakdownRows` (cells from `buildActiveCells({status, cycleDay}, now)`, split before filtering by `window`):

- `new_listeners = listeners` = `splitInt(overview.listeners)`; `returning_listeners` = `splitInt(max(0, overview.total_listeners - overview.listeners))`; `total_listeners` = new + returning. `streams`, `followers` split from the overview. `impressions`, `ad_clicks`, `link_clicks` are `null` when the overview value is `null`, otherwise split.
- `spend_media` = `splitCents(overview.spend_media)`. `fees` per row use the overview formula (`rate > 0 && spend > 0 ? round2(spend / (1 - rate) - spend) : 0`, rate = `store.feeRate`); `spend_total = round2(spend_media + fees)`.
- `cpl`, `cpf` = spend / listeners, spend / followers (4 decimals, `0` when the divisor is `0`). `streams_per_listener` = streams / total_listeners (4 decimals, `0` when `0`). `cpc_linkclick`, `ctr_linkclick`, `ctr_adclick` are `null` when `link_clicks` or `impressions` is `null` or `0`, else spend/link_clicks, link_clicks/impressions, ad_clicks/impressions (4 decimals). `cost_per_result = cpf`, `result_type = 'follow'`.
- Identity: `provider 'soundlink'`, `account_id = store.organizationId`, `schema_version '1.1'`, `report_date_timezone 'UTC'`, `exported_at = now.toISOString()`, `campaign_id`, `campaign_name`, `campaign_target_type` (`playlist` if `playlistId`, `track` if `trackId`, else `null`), `campaign_target_isrc null`, `campaign_target_spotify_track_id = trackId`, `campaign_target_playlist_id = playlistId`, `currency` and `currency_account` `'USD'`.

Route flow (breakdown): after the existing creatives route, match `/^\/v1\/campaigns\/([^/]+)\/metrics\/breakdown\/export$/` for `GET`; unknown campaign → `404 campaign_not_found`; read `startDate`/`endDate` with `new URL(request.path, 'http://emulator.local').searchParams`; on a failed window return `failure(400, code, message)`; otherwise `jsonlResponse(buildBreakdownRows(store, campaign, window, new Date()))`.

`server.ts`: when `response.text !== undefined`, `res.writeHead(response.status, response.headers)` and `res.end(response.text)`, before the JSON branch.

- [ ] **Step 1: Write the failing tests** in `tests/emulator/campaign-exports.test.ts`. Setup mirrors `tests/emulator/auto-renew-batch-overview.test.ts` (`createApiEmulator({ apiKey: EMULATOR_API_KEY, initialWalletBalance: 500 })`, create via `dispatch` with `DEFAULT_CREATE_BODY`, activate via `/__emulator/campaigns/:id/transition`). Compute `today` as `new Date().toISOString().slice(0, 10)`. Parse bodies with `parseNdjsonText` from `src/core/jsonl.js`.
  - `breakdown export returns JSONL with row count header`: after activate, response `status 200`, `headers['Content-Type'] === 'application/x-ndjson'`, `headers['X-Row-Count'] === '3'`, 3 rows with `country_code` `['DE', 'GB', 'US']`, all `report_date === today`, `schema_version === '1.1'`, `account_id === 'org_emulator'`.
  - `breakdown sums match the overview`: `set_metrics { mediaSpendUsd: 40.01, listeners: 101, streams: 250, cycleDay: 4 }` (spend via the third `transition` arg or the `mediaSpendUsd` body field). 12 rows. `Math.round(sum(spend_media) * 100) === 4001`; `sum(streams) === overview.streams`; `sum(listeners) === overview.listeners` where overview is `GET /v1/campaigns/:id/metrics/overview`. Per row `total_listeners === new_listeners + returning_listeners` and `listeners === new_listeners`.
  - `breakdown startDate and endDate filter rows`: with `cycleDay: 4`, `startDate=endDate=today` gives 3 rows; `startDate=<today-1>` gives 6 rows; sums of that window are less than or equal to the totals.
  - `breakdown fees follow the fee rate`: emulator `plan: 'enterprise'`, spend `40`: every row has `spend_total === round2(spend_media + fees)` and `Math.abs(sum(fees) - overview.fees) <= 0.03`.
  - `breakdown is empty while creating`: no activate → `X-Row-Count '0'`, `text === ''`.
  - `breakdown unknown campaign is 404`: `status 404`, `error.code === 'campaign_not_found'`.
  - `breakdown rejects bad windows`: reversed range → `400 invalid_date_range`; `startDate=nope` → `400 invalid_query_parameter`; 91-day span → `400 invalid_query_parameter`; 90-day span → `200`.
  - Review Focus tests (breakdown side): zero metrics (`listeners 0, streams 0, mediaSpendUsd 0`) → every numeric field is a finite number or `null` only where the schema allows (`impressions`, `ad_clicks`, `link_clicks`, `cpc_linkclick`, `ctr_*`), and a JSON round-trip has no `null` in `cpl`, `cpf`, `streams_per_listener`; `listeners: 2, cycleDay: 4` → sum is `2` and at least 10 rows have `listeners === 0`; only `startDate` and only `endDate` return `200`.
  - `SDK collect parses the breakdown export over listen`: `emu.listen()`, `new Soundlink({ apiKey, baseUrl: server.baseUrl })`, `soundlink.metrics.breakdown.export.collect(campaignId)` → `data.rowCount === 3`, `data.rows.length === 3`, `error === null`. Also `collect(campaignId, { startDate: today, endDate: today })`.

- [ ] **Step 2: Run** `npx vitest run tests/emulator/campaign-exports.test.ts`. Expected: FAIL (routes return `404 not_found`).

- [ ] **Step 3: Implement** `text`/`headers` on `EmulatorResponse`, `jsonlResponse`, the `server.ts` branch, `buildBreakdownRows`, and the route, per the rules above.

- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npm test` to confirm no existing emulator test regressed.

- [ ] **Step 5: Commit**

```bash
git add src/emulator tests/emulator/campaign-exports.test.ts
git commit -m "feat(emulator): add campaign breakdown JSONL export"
```

---

### Task 3: Engagement route

**Files:**

- Modify: `src/emulator/exports.ts` (add `buildEngagementRows`)
- Modify: `src/emulator/dispatch.ts` (route)
- Test: `tests/emulator/campaign-exports.test.ts`

**Interfaces:**

- Consumes: Task 1 helpers, Task 2 `jsonlResponse`.
- Produces: `export function buildEngagementRows(store: EmulatorStore, campaign: EmulatorCampaignRecord, window: ExportWindow, context: EngagementContext | undefined, now: Date): EngagementRow[]`

Row rules (same cells and split-then-filter as breakdown):

- Campaign context = `'playlist'` when `playlistId` is set, else `'catalog'`. When `context` is defined and differs, return `[]`.
- `new_listeners` = split of `overview.listeners`; `returning_listeners` = split of `max(0, total_listeners - listeners)`; `listeners` = new + returning; `streams` = split of `overview.streams`.
- `new_listener_streams = listeners > 0 ? Math.round(streams * new / listeners) : streams`; `returning_listener_streams = streams - new_listener_streams`; `spl = listeners > 0 ? streams / listeners : 0` (4 decimals).
- `status = campaign.status`; `engaged_spotify_track_id = trackId ?? 'emulator_track'`; `engaged_track_name = trackName ?? 'Emulator Track'`; `engaged_track_isrc null`; `playlist_position = context === 'playlist' ? 1 : null`; identity fields as in breakdown with `schema_version '1.0'`.

Route: `GET /v1/campaigns/:id/metrics/engagement/export`, same flow as breakdown plus `engagementContext` query: any value other than `catalog` or `playlist` → `400 invalid_query_parameter` (after the 404 check).

- [ ] **Step 1: Write the failing tests** in the same file:
  - `engagement export totals follow the row schema`: `set_metrics { listeners: 101, streams: 250, cycleDay: 4 }`, 12 rows, `sum(streams) === overview.streams`, `sum(new_listeners) === overview.listeners`, `sum(listeners) === overview.total_listeners`, per row `listeners === new_listeners + returning_listeners` and `streams === new_listener_streams + returning_listener_streams`.
  - `engagement context filter`: a track campaign with `engagementContext=catalog` returns 12 rows, `engagement_context === 'catalog'`, `playlist_position === null`; `engagementContext=playlist` returns `X-Row-Count '0'`.
  - `engagement playlist campaign`: create with `spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'`; rows have `engagement_context === 'playlist'`, `playlist_position === 1`, `engaged_spotify_track_id === 'emulator_track'`; `engagementContext=catalog` is empty.
  - `engagement validation and 404`: `engagementContext=other` → `400 invalid_query_parameter`; unknown campaign → `404 campaign_not_found`; reversed dates → `400 invalid_date_range`; creating campaign → empty.
  - `engagement zero metrics`: `spl === 0` and no `null` in numeric fields; `engagement startDate/endDate` filters like breakdown.
  - `SDK collect parses the engagement export over listen`: `soundlink.metrics.engagement.export.collect(campaignId)` and with `{ engagementContext: 'catalog' }` returns `rowCount 3`; `{ engagementContext: 'playlist' }` returns `rowCount 0`.

- [ ] **Step 2: Run** `npx vitest run tests/emulator/campaign-exports.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement** `buildEngagementRows` and the route.

- [ ] **Step 4: Run** the same command. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/emulator tests/emulator/campaign-exports.test.ts
git commit -m "feat(emulator): add campaign engagement JSONL export"
```

---

### Task 4: Docs, changeset, full verification

**Files:**

- Modify: `docs/api-emulator.md` (Harness/Recipes area and the "Not production" implemented-subset line; errors table)
- Create: `.changeset/emulator-campaign-exports.md`

- [ ] **Step 1: Update `docs/api-emulator.md`.** Add a "Breakdown and engagement exports" section after "Budget increase" covering: both routes; rows derived from `set_metrics`; countries `DE`, `GB`, `US` evenly; `cycleDay` days ending today (UTC); `creating` returns an empty 200; sums equal the overview over all active days and a narrower window is a subset; engagement sums follow the row schema (`listeners` = overview `total_listeners`); `engagementContext` is `playlist` for playlist campaigns, else `catalog`; the date defaults and the 90-day cap; error codes. A short SDK example with `collect`. Add the two routes to the "Only a subset of `/v1`" line and the new `400` codes to the errors table.

- [ ] **Step 2: Add the changeset**

```md
---
'soundlink': minor
---

Add `GET /v1/campaigns/:id/metrics/breakdown/export` and `GET /v1/campaigns/:id/metrics/engagement/export` to the API emulator. Rows are JSONL, derived from the metrics set with `set_metrics`.
```

- [ ] **Step 3: Verify.** Run `npm run format` (formats the new md files), then `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`. Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs .changeset
git commit -m "docs(emulator): document campaign breakdown and engagement exports"
```

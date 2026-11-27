# Emulator: campaign breakdown and engagement JSONL exports

Ticket: SOU-7844. Deliverable: merged PR, released to npm as a minor.

## Intent

API consumers testing against `soundlink/api-emulator` can call the overview batch and the creatives batch, but not the two per-campaign JSONL exports. They fake those responses today. Add both routes so their code runs against the emulator unchanged, using `metrics.breakdown.export.collect` and `metrics.engagement.export.collect`.

## Scope

- `GET /v1/campaigns/:id/metrics/breakdown/export`: JSONL of `BreakdownRow` (`campaign_country_daily`, schema 1.1).
- `GET /v1/campaigns/:id/metrics/engagement/export`: JSONL of `EngagementRow` (`campaign_engagement_daily`, schema 1.0), with the `engagementContext` filter.
- Rows come from the metrics a harness sets with `set_metrics`, split across the campaign's active days and its countries.

## Goals

- Both routes return JSONL that the SDK's `collect` helpers parse, over `listen` and over in-process `dispatch`.
- `startDate` / `endDate` filter the rows.
- Over all active days, the sums of `spend_media`, `streams` and `listeners` in the breakdown equal the overview totals (`spend_media`, `streams`, `listeners`). For engagement, the sums follow the engagement row schema (see Design 5). A narrower window returns a subset of the days.
- Unknown campaign returns `404 campaign_not_found`.

## Non-goals / anti-goals

- No date windows on the overview. It stays lifetime-only.
- No post-campaign engagement activity, no per-creative or per-track delivery simulation, no randomness.
- No new harness actions or options, and no new stored campaign state. Countries are a fixed list.
- Do not name customers, partners or internal consumers in code, docs or the changeset.

## Constraints

- `EmulatorResponse` has only `status` and `json`, and `listen` hardcodes `application/json`. The SDK client treats a JSON content type on a 200 as an error envelope. JSONL needs `Content-Type: application/x-ndjson` and an `X-Row-Count` header.
- Campaigns have no activation date and no countries today. Only `createdAt` and `cycleDay` exist, and `tierTargeting` is discarded on create.
- Errors keep the existing JSON envelope.

## Approaches considered

1. **Derive rows on request from the campaign record (chosen).** Compute rows from the stored overview, spend, `cycleDay`, `createdAt` and countries each time. No new stored state, rows always match the overview.
2. Store a generated row set at `set_metrics` time. Rows could drift from the overview and must be invalidated on every metric change. Rejected.
3. Add harness controls for dates and per-country weights. More realistic, but more surface than the ticket asks. Left for a later change.

## Design

1. **Response type.** `EmulatorResponse` gains optional `text` and `headers`. `listen` writes `text` with the given headers; `dispatch` returns them. When `text` is absent the JSON path is unchanged.
2. **Active days.** The last active day is today (UTC). Rows cover `cycleDay` consecutive days ending today, so day 1 is `today - (cycleDay - 1)`. A new campaign has 1 day, and tests widen it with `set_metrics { cycleDay }`. This keeps every row in the past or today, like the real API, so the default window (last 90 days ending today) always contains all active days. A campaign in status `creating` has no delivery: both routes return an empty 200 with `X-Row-Count: 0`.
3. **Countries.** A fixed list for every campaign: `US`, `GB`, `DE`. Nothing is stored on the campaign, and `tierTargeting` stays ignored (a later change can add per-campaign countries).
4. **Splitting.** Build one cell per `(day, country)`, ordered by day then country. Split `spend_media` (in cents), `streams`, `listeners`, `followers` and the other counters evenly across the cells with one helper. Remainders go to the earliest cells, so sums are exact. `returning_listeners` is split from `total_listeners - listeners`, so `total_listeners = new + returning` holds per row. Derived fields (`spend_total`, `fees`, `cpl`, `cpf`, `streams_per_listener`, and so on) are computed per row with the same formulas as the overview. Nullable counters (`impressions`, `ad_clicks`, `link_clicks`) stay `null` when the overview has `null`.
5. **Engagement.** One engaged track per campaign. Context is `playlist` when the campaign has a playlist id, otherwise `catalog` (including a URL that is neither a track nor a playlist). The engaged track is the promoted track when there is one, otherwise the placeholder `emulator_track` / `Emulator Track` (`playlist_position` is `1` for `playlist`, `null` for `catalog`). Totals follow the row schema, where `listeners = new_listeners + returning_listeners`:
   - sum of `streams` = overview `streams`
   - sum of `new_listeners` = overview `listeners`
   - sum of `returning_listeners` = overview `total_listeners - listeners`, so sum of `listeners` = overview `total_listeners`
   - `new_listener_streams` and `returning_listener_streams` split `streams` in proportion to new and returning listeners and always sum to `streams`
   - `spl = streams / listeners` per row (`0` when `listeners` is `0`)

   An `engagementContext` that matches no rows returns an empty 200 with `X-Row-Count: 0`.

6. **Ordering.** Breakdown: `(report_date asc, country_code)`. Engagement: `(report_date asc, engagement_context, country_code, engaged_spotify_track_id)`.
7. **Validation.** As in the OpenAPI spec: an unparseable date, a range over 90 days, or an invalid `engagementContext` returns `400 invalid_query_parameter`. `endDate` before `startDate` returns `400 invalid_date_range`. Defaults: `endDate` is today (UTC), and `startDate` is `endDate - 89 days`. Filtering keeps only rows whose `report_date` is inside the inclusive window.
8. **Fields.** `account_id` is the emulator organization id. `exported_at` is the request time. `campaign_target_*` come from the stored Spotify ids. `report_date_timezone` is `UTC`, `currency` and `currency_account` are `USD`.
9. **Files touched.** `src/emulator/exports.ts` (new: cells, split helper, both row builders, date-window parsing), `src/emulator/dispatch.ts` (two routes, `text`/`headers` on `EmulatorResponse`), `src/emulator/server.ts` (write `text` and headers), `docs/api-emulator.md`, one changeset, and one test file in `tests/emulator/`. No change to `store.ts`, `transitions.ts`, or the public SDK types.
10. **Tests, docs, release.** Vitest tests in `tests/emulator/` cover each DoD item, the splits, filters, validation, and SDK `collect` over `listen`. In-process `dispatch` tests assert on the `text` body parsed with `parseNdjsonText`. No fetch adapter or other public surface is added. Update `docs/api-emulator.md` (routes, limits, the "implemented subset" line). Add a minor changeset with generic wording.

## Left to the builder

File layout, helper names, the exact largest-remainder or earliest-first allocation, and the value of `cost_per_result` / `result_type` and the ratio fields, as long as they follow the OpenAPI definitions and stay deterministic.

# soundlink

Official TypeScript SDK for the [Soundlink Public API](https://docs.getsoundlink.com).

## Install

```bash
npm install soundlink
```

> **Version note:** `2.x` is the current line. `1.x` sent the deprecated `x-api-key` header — upgrade to `2.0.0+` for `Authorization: Bearer`. Write surface (create / budget / stop / tiers) shipped in `1.2.0` and remains in `2.x`.

Requires **Node.js 18+** (native `fetch`). Works in Edge Runtime when `fetch` is available.

## Quickstart

```typescript
import { Soundlink } from 'soundlink';

const soundlink = new Soundlink({
  apiKey: process.env.SOUNDLINK_API_KEY!,
});

// Verify your key
const { data, error, meta } = await soundlink.ping();
if (error) {
  console.error(error.message, meta?.requestId);
  process.exit(1);
}

console.log(data?.status); // "ok"
```

You can also pass the API key directly:

```typescript
const soundlink = new Soundlink('sk_your_prefix_your_secret');
```

## Authentication

Pass your Soundlink API key (`sk_<prefix>_<secret>`) via the client constructor.
The SDK sends it as `Authorization: Bearer sk_...` on every request.

Your organization is determined from the key. Do not send Firebase ID tokens on the Public API host.

Write methods on campaigns require the `campaigns:write` scope and an `Idempotency-Key` (passed as `idempotencyKey` on the method options). Soundlink create also requires `soundlinks:write` and `idempotencyKey`. Soundlink delete requires `soundlinks:write` and does **not** send `Idempotency-Key`.

## Response pattern

Every method returns:

```typescript
type ApiResponse<T> = {
  data: T | null;
  error: ApiError | null;
  meta?: { requestId: string };
};
```

Example:

```typescript
const { data, error } = await soundlink.campaigns.list({ page: 1, pageSize: 100 });

if (error) {
  console.error(error.code, error.message, error.requestId);
  return;
}

console.log(data.items);
```

HTTP errors from the API are **never thrown**. Exceptions are reserved for SDK configuration, parsing, and unexpected transport failures.

## Campaigns

```typescript
const { data, error } = await soundlink.campaigns.list({
  page: 1,
  pageSize: 100,
  sortBy: 'createdAt',
  sortOrder: 'desc',
});

const { data: campaign } = await soundlink.campaigns.get('camp_abc123');
// campaign.generation === 3 → wallet (writable)

const { data: activity } = await soundlink.campaigns.activity('camp_abc123', {
  startDate: '2026-03-01',
});

// Async iterator across all pages
for await (const item of soundlink.campaigns.listAll({ pageSize: 100 })) {
  console.log(item.campaignId, item.generation);
}
```

### Create, budget, tiers, stop (wallet / `generation: 3`)

```typescript
const { data: strategies } = await soundlink.strategies.list();

const { data: created, error: createError } = await soundlink.campaigns.create(
  {
    spotifyUrl: 'https://open.spotify.com/track/...',
    dailyBudget: 20,
    durationDays: 7,
    genre: 'Pop',
    strategyType: 'maximum_growth',
  },
  { idempotencyKey: 'create-mytrack-01' },
);

if (createError || !created) {
  console.error(createError);
  return;
}

await soundlink.campaigns.increaseBudget(
  created.campaignId,
  { amount: 50, mode: 'current_and_renewals' },
  { idempotencyKey: 'budget-inc-01' },
);

// GET returns `tierId`; PATCH expects the same value as `targetingTierId`
const { data: tiers } = await soundlink.campaigns.tiers.get(created.campaignId);
if (!tiers) {
  return;
}
await soundlink.campaigns.tiers.update(created.campaignId, {
  items: tiers.tiers.map((tier) => ({
    targetingTierId: tier.tierId,
    isEnabled: tier.isEnabled,
    newAllocationPercent: tier.allocationPercent,
  })),
});

await soundlink.campaigns.updateAutoRenew(
  created.campaignId,
  { autoRenew: false },
  { idempotencyKey: 'auto-renew-01' },
);

await soundlink.campaigns.stop(created.campaignId, {
  idempotencyKey: 'stop-01',
});

const { data: wallet } = await soundlink.wallet.get();
// wallet.available is balance minus reserved
```

### Pixels (`pixels:read` / `pixels:write`)

```typescript
const { data: pixels } = await soundlink.pixels.list();
// pixels[0].isDefault, .status, .lastErrorCode, .errorSince

await soundlink.pixels.update('1234567890123456', {
  platform: 'meta',
  accessToken: process.env.META_CAPI_TOKEN!,
  isDefault: true,
});

await soundlink.pixels.sendTestEvent('1234567890123456');
await soundlink.pixels.delete('1234567890123456'); // 204 → { data: null, error: null }
```

Custom strategy create (requires `tierTargeting`):

```typescript
const { data: created } = await soundlink.campaigns.create(
  {
    spotifyUrl: 'https://open.spotify.com/track/...',
    dailyBudget: 20,
    durationDays: 7,
    genre: 'Pop',
    strategyType: 'custom',
    tierTargeting: {
      customTiers: [{ name: 'US focus', countries: ['US'], percentBudget: 100 }],
    },
  },
  { idempotencyKey: 'create-custom-01' },
);
```

## Soundlinks (self-serve)

List, get, and metrics require `soundlinks:read`. Create and delete require `soundlinks:write`. Lists only soundlinks **not** linked to a campaign (campaign-backed links use the Campaigns API). Schemas have no spend/fee fields.

```typescript
const { data, error } = await soundlink.soundlinks.list({
  page: 1,
  pageSize: 100,
  sortBy: 'createdAt',
  sortOrder: 'desc',
});

const { data: created } = await soundlink.soundlinks.create(
  {
    name: 'Midnight Drive',
    spotifyUrl: 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
  },
  { idempotencyKey: 'create-midnight-drive-01' },
);

const { data: detail } = await soundlink.soundlinks.get('sl_abc123');
// detail.autoFollow, detail.appleMusicUrl, detail.youtubeMusicUrl

const { data: archived } = await soundlink.soundlinks.delete('sl_abc123');
// archived.status === 'archived'

const { data: overview } = await soundlink.soundlinks.metricsOverview('sl_abc123', {
  startDate: '2026-08-01',
  endDate: '2026-08-31',
});

const { data: breakdown } = await soundlink.soundlinks.breakdown.list('sl_abc123', {
  page: 1,
  pageSize: 50,
});

const { data: engagement } = await soundlink.soundlinks.engagement.list('sl_abc123', {
  engagementContext: 'catalog',
});

// JSONL: soundlinks.breakdown.export / soundlinks.engagement.export (same pattern as Metrics below)

// Premium: cohort retention + listening insights (same as Metrics section)
const { data: retention } = await soundlink.soundlinks.retention('sl_abc123');
const { data: insight } = await soundlink.soundlinks.listeningInsights(
  'sl_abc123',
  'stream-split',
);
```

## Metrics

```typescript
const { data: overview } = await soundlink.metrics.overview('camp_abc123', {
  startDate: '2026-01-01',
  endDate: '2026-03-31',
});

const { data: creatives } = await soundlink.metrics.creatives('camp_abc123');
// lifetime snapshot, grouped by background video. No date range.

const { data: creativeDaily } = await soundlink.metrics.creativeDaily('camp_abc123', {
  startDate: '2026-03-01',
  endDate: '2026-03-31',
});

const { data: breakdown } = await soundlink.metrics.breakdown.list('camp_abc123', {
  page: 1,
  pageSize: 50,
});

// Cohort retention — premium plan (`403 premium_plan_required` otherwise)
const { data: retention } = await soundlink.metrics.retention('camp_abc123', {
  startDate: '2026-08-01',
  endDate: '2026-08-31',
});

// Listening insights — premium; SDK uses a 120s timeout (API often takes 30–50s)
const { data: insight } = await soundlink.campaigns.listeningInsights(
  'camp_abc123',
  'other-artists',
);
```

### JSONL exports (streaming)

Export endpoints stream newline-delimited JSON. Use `for await` for pipelines:

```typescript
const { data: stream, error } = await soundlink.metrics.breakdown.export(
  'camp_abc123',
  {
    startDate: '2026-01-01',
    endDate: '2026-03-31',
  },
);

if (error || !stream) return;

for await (const row of stream) {
  await warehouse.insert(row);
}
```

Collect all rows into memory when the dataset is small:

```typescript
const { data } = await soundlink.metrics.breakdown.export.collect('camp_abc123');
console.log(data?.rowCount, data?.rows);
```

Engagement exports work the same way:

```typescript
const { data: stream } = await soundlink.metrics.engagement.export('camp_abc123', {
  engagementContext: 'catalog',
});
```

## Configuration

```typescript
const soundlink = new Soundlink({
  apiKey: process.env.SOUNDLINK_API_KEY!,
  baseUrl: 'https://api.getsoundlink.com', // default
  timeout: 30_000, // ms, default
  maxRetries: 2, // retries on 429/5xx (same Idempotency-Key on writes), default
  fetch: customFetch, // optional, for Edge/tests
});
```

## Error codes

| Code                       | Typical HTTP |
| -------------------------- | ------------ |
| `invalid_api_key`          | 401          |
| `api_key_revoked`          | 401          |
| `api_key_expired`          | 401          |
| `invalid_token`            | 401          |
| `insufficient_scope`       | 403          |
| `access_denied`            | 403          |
| `wallet_not_enabled`       | 403          |
| `not_found`                | 404          |
| `campaign_not_found`       | 404          |
| `invalid_request`          | 400          |
| `invalid_query_parameter`  | 400          |
| `invalid_date_range`       | 400          |
| `page_size_exceeded`       | 400          |
| `insufficient_credit`      | 402          |
| `idempotency_key_conflict` | 409          |
| `tier_update_cooldown`     | 409          |
| `rate_limit_exceeded`      | 429          |
| `internal_error`           | 500          |

Include `meta.requestId` (or `error.requestId`) when contacting Soundlink support. On `402 insufficient_credit`, check `error.details` for `available` / `required` wallet amounts.

## API reference

Full endpoint documentation: [docs.getsoundlink.com](https://docs.getsoundlink.com).

OpenAPI spec shipped with this package: `openapi/soundlink-public-api-v1.yaml`.

## Test before publish

Smoke test against the live API (uses the local SDK source, not npm):

```bash
# Option A — .env file
cp .env.example .env
# edit .env → SOUNDLINK_API_KEY=sk_...

npm run test:live

# Option B — inline
SOUNDLINK_API_KEY=sk_your_prefix_your_secret npm run test:live

# Option C — CLI argument
npm run test:live -- sk_your_prefix_your_secret
```

The script runs: `ping` → `strategies.list` → `campaigns.list` (checks `generation`) → `campaigns.get` → `metrics.overview` (best effort).

Opt-in write smoke (debits wallet — use a sandbox org):

```bash
SOUNDLINK_LIVE_WRITE=1 \
SOUNDLINK_LIVE_SPOTIFY_URL='https://open.spotify.com/track/...' \
SOUNDLINK_API_KEY=sk_... \
npm run test:live
```

## Local Public API emulator

For partner integration tests without Meta spend, import `soundlink/emulator` (not re-exported from `soundlink`).

It exposes the same `/v1` envelopes the SDK expects, plus a **local-only** harness under `/__emulator/*` to force lifecycle transitions (activate, Meta reject, spend, end).

```typescript
import { Soundlink } from 'soundlink';
import { createEmulator } from 'soundlink/emulator';

const emu = createEmulator({
  apiKey: 'sk_emulator_test',
  initialWalletBalance: 500,
  // Prefer `plan` (sets fee + self-serve limits). `feeRate` overrides when needed.
  plan: 'enterprise', // fee 10%; or 'self_serve_5000' / 'label_power' / …
  // feeRate: 0.12,
});

const server = await emu.listen();
const soundlink = new Soundlink({
  apiKey: 'sk_emulator_test',
  baseUrl: server.baseUrl,
});

const { data: created } = await soundlink.campaigns.create(
  {
    spotifyUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
    dailyBudget: 10,
    durationDays: 7,
    genre: 'Pop',
    strategyType: 'maximum_growth',
  },
  { idempotencyKey: 'demo-create-1' },
);

await fetch(
  `${server.baseUrl}/__emulator/campaigns/${created!.campaignId}/transition`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'activate' }),
  },
);

const { data: detail } = await soundlink.campaigns.get(created!.campaignId);
console.log(detail?.status); // "active"

await server.close();
```

**Harness routes** (no auth; safe only because listen refuses non-loopback):

| Method | Path                                    | Purpose                                          |
| ------ | --------------------------------------- | ------------------------------------------------ |
| `POST` | `/__emulator/reset`                     | Clear wallet/campaigns/idempotency               |
| `POST` | `/__emulator/wallet`                    | `{ balance }` without deleting campaigns         |
| `POST` | `/__emulator/campaigns/{id}/transition` | `activate` · `reject_meta` · `set_spend` · `end` |

**Plans** (`createEmulator({ plan })`)

| Plan                             | Default fee | Premium (`PLAN_LEVEL >= 3`) | Self-serve `maxNewListeners` |
| -------------------------------- | ----------- | --------------------------- | ---------------------------- |
| _(omit)_                         | `0`         | —                           | —                            |
| `free` / `artist_pro` / `studio` | `0.2`       | no                          | —                            |
| `label_power`                    | `0.15`      | yes                         | —                            |
| `enterprise`                     | `0.1`       | yes                         | —                            |
| `self_serve_5000`                | `0.2`       | yes                         | `5000`                       |
| `self_serve_25000`               | `0.2`       | yes                         | `25000`                      |

`feeRate` always wins over the plan default. Self-serve caps attributed listeners seeded on harness `activate`; when the allowance is exhausted, further `activate` calls return `400`. Inspect with `emu.getPlan()` (`premium` is metadata only today — it does not change `/v1` payloads).

**Documented divergences vs production**

- After create/stop settle, wallet always reports `reserved === 0` (`available === balance`).
- Without `plan` / `feeRate`, fee defaults to `0` → `spend_total === spend_media`, `fees === 0`.
- `reject_meta` → `inactive` **without** wallet credit; refund only on public `stop` or harness `end`.
- Create `402 insufficient_credit` **releases** the Idempotency-Key (same key after top-up → `201`). Do not copy budget-increase 402 replay behavior.
- Stop Idempotency-Key hash is `{ campaignId }` only.
- Self-serve listener caps are emulator harness rules (not a Public API create error).
- Create/auth error codes and messages match Public API (`422 invalid_daily_budget` / `invalid_duration_days`, Idempotency-Key wording, `402`/`401` strings).
- Unit tests can call `emu.dispatch(...)` with no TCP.

## Roadmap

- Video import helpers (`videos:write`) — when prioritized
- Webhook helpers — when Public API webhooks ship

## Releases

GitHub Releases are created automatically when a **Version packages** PR is merged. Release notes come from `CHANGELOG.md`, with PR/issue links when referenced in changesets.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full flow.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

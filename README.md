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

Write methods require the `campaigns:write` scope and an `Idempotency-Key` (passed as `idempotencyKey` on the method options).

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

await soundlink.campaigns.stop(created.campaignId, {
  idempotencyKey: 'stop-01',
});
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

## Metrics

```typescript
const { data: overview } = await soundlink.metrics.overview('camp_abc123', {
  startDate: '2026-01-01',
  endDate: '2026-03-31',
});

const { data: breakdown } = await soundlink.metrics.breakdown.list('camp_abc123', {
  page: 1,
  pageSize: 50,
});
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
| `mixed_credentials`        | 401          |
| `insufficient_scope`       | 403          |
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

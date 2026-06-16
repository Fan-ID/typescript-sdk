# soundlink

Official TypeScript SDK for the [Soundlink Public API](https://docs.getsoundlink.com).

## Install

```bash
npm install soundlink
```

> **Version note:** `1.0.0` on npm was an empty placeholder. **`1.1.0`** is the first official SDK release.

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
The SDK sends it in the `x-api-key` header on every request.

Your organization is determined from the key. Do not send Firebase Bearer tokens on the Public API host.

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

// Async iterator across all pages
for await (const item of soundlink.campaigns.listAll({ pageSize: 100 })) {
  console.log(item.campaignId);
}
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
  maxRetries: 2, // retries on 429/5xx, default
  fetch: customFetch, // optional, for Edge/tests
});
```

## Error codes

| Code                      | Typical HTTP |
| ------------------------- | ------------ |
| `invalid_api_key`         | 401          |
| `api_key_revoked`         | 401          |
| `api_key_expired`         | 401          |
| `mixed_credentials`       | 401          |
| `insufficient_scope`      | 403          |
| `not_found`               | 404          |
| `campaign_not_found`      | 404          |
| `invalid_query_parameter` | 400          |
| `invalid_date_range`      | 400          |
| `page_size_exceeded`      | 400          |
| `rate_limit_exceeded`     | 429          |
| `internal_error`          | 500          |

Include `meta.requestId` (or `error.requestId`) when contacting Soundlink support.

## API reference

Full endpoint documentation: [getsoundlink.com/docs](https://getsoundlink.com/docs).

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

The script runs: `ping` → `campaigns.list` → `campaigns.get` → `metrics.overview` (best effort).

## Roadmap

- `metrics.engagement.list` — spec-ready; backend route pending
- `campaigns.create` — when `campaigns:write` scope opens in v2
- Webhook helpers — when Public API webhooks ship

## Releases

GitHub Releases are created automatically when a **Version packages** PR is merged. Release notes come from `CHANGELOG.md`, with PR/issue links when referenced in changesets.

See [CONTRIBUTING.md](./CONTRIBUTING.md#release-process) for the full flow.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

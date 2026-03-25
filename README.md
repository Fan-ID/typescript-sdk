# Soundlink SDK

TypeScript / JavaScript client for the **Soundlink API** (`/api/v1`). It matches the same HTTP contract the product app uses: Bearer auth, `x-organization-id`, and JSON bodies/query params as the backend expects.

---

## Table of contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage overview](#usage-overview)
- [`SoundlinkClient`](#soundlinkclient)
- [Flat functions (environment-based)](#flat-functions-environment-based)
- [Code examples](#code-examples)
- [API methods reference](#api-methods-reference)
- [Types & payloads](#types--payloads)
- [Return values & errors](#return-values--errors)
- [Advanced](#advanced)
- [Examples](#examples)

---

## Requirements

- **Node.js 18+** (global `fetch`)
- Valid **Bearer token** and **organization id** for the API you call (same as the web app)

---

## Installation

From the monorepo package (or after publishing to npm):

```bash
npm install soundlink
```

Build from source in this directory:

```bash
npm install
npm run build
```

---

## Configuration

The client needs three pieces of information:

| Input        | Environment variable        | HTTP usage                                                                         |
| ------------ | --------------------------- | ---------------------------------------------------------------------------------- |
| API token    | `SOUNDLINK_TOKEN`           | `Authorization: Bearer <token>`                                                    |
| Organization | `SOUNDLINK_ORGANIZATION_ID` | `x-organization-id: <uuid>`                                                        |
| API base URL | `SOUNDLINK_BASE_URL`        | Prefix for paths (no trailing slash), same role as `FAN_ID_API_BASE_URL` in the UI |

Optional:

| Variable          | Effect                                                         |
| ----------------- | -------------------------------------------------------------- |
| `SOUNDLINK_DEBUG` | Set to `true` / `1` / `yes` to log requests to `console.debug` |

You can override any of these by passing a config object to [`createClient()`](#soundlinkclient) instead of relying on `process.env`.

---

## Usage overview

There are **two** supported styles:

1. **Explicit client** — `createClient({ ... })` (recommended for apps with config injection or multiple orgs).
2. **Flat functions** — `import { listPaidCampaigns } from "soundlink"` — they use a **lazy singleton** configured from `process.env` on first use.

Both call the same endpoints and return the same `Result<T>` shape.

---

## `SoundlinkClient`

```ts
import { createClient } from "soundlink";

const client = createClient({
  apiKey: process.env.SOUNDLINK_TOKEN,
  organizationId: process.env.SOUNDLINK_ORGANIZATION_ID,
  baseUrl: process.env.SOUNDLINK_BASE_URL,
  timeout: 30_000, // optional, milliseconds
  debug: true, // optional
});

const { data, error } = await client.listPaidCampaigns({
  page: 1,
  pageSize: 10,
});
```

Pass **no arguments** to read everything from env:

```ts
const client = createClient();
```

You can also pass a **custom `fetch`** (testing, proxies, edge runtimes):

```ts
const client = createClient(
  {
    /* ... */
  },
  customFetch,
);
```

---

## Flat functions (environment-based)

```ts
import {
  createPaidCampaign,
  createCheckoutPaidCampaign,
  createOrganicCampaign,
  listPaidCampaigns,
  listOrganicCampaigns,
} from "soundlink";

// First call builds an internal client from process.env
const { data, error } = await listPaidCampaigns({ page: 1, pageSize: 10 });
```

**Note:** The singleton is created once. If you need **different tokens or orgs** in the same process, use **multiple** `createClient()` instances instead of the flat API.

---

## Code examples

All snippets assume `createClient` is configured (env or explicit config). Patterns are the same if you use **flat imports** — replace `client.method(...)` with `method(...)` from `"soundlink"`.

### List paid campaigns

```ts
import { createClient } from "soundlink";

const client = createClient();

const { data, error } = await client.listPaidCampaigns({
  page: 1,
  pageSize: 20,
  sortBy: "createdAt",
  sortOrder: "desc",
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

for (const campaign of data.items) {
  console.log(campaign.id, campaign.status, campaign.dailyBudget);
}
console.log(
  `Total: ${data.total}, page ${data.page}/${data.totalPages ?? "?"}`,
);
```

### Create managed paid campaign

`POST /api/v1/campaigns/managed`. Replace IDs and URLs with real values. The API may return **403** if the caller is not allowed (e.g. non-CSM or org without invoice billing).

```ts
import { createClient } from "soundlink";

const client = createClient();

const { data, error } = await client.createPaidCampaign({
  spotifyLink: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
  dailyBudget: 50,
  campaignDuration: 14,
  smartLinkName: "Summer single promo",
  createdBy: "00000000-0000-0000-0000-000000000001", // user id string expected by API
  selectedGenre: "pop",
  strategyType: "maximum_growth",
  platform: "meta",
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log("Created:", data.campaignId, data.smartLinkId);
```

### Create paid campaign after Stripe checkout

`POST /api/v1/campaigns` — use when checkout already produced Stripe session / payment intent IDs.

```ts
import { createClient } from "soundlink";

const client = createClient();

const { data, error } = await client.createCheckoutPaidCampaign({
  spotifyLink: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
  dailyBudget: 50,
  campaignDuration: 14,
  smartLinkName: "Album launch",
  createdBy: "00000000-0000-0000-0000-000000000001",
  paymentInfo: {
    sessionId: "cs_test_...",
    paymentIntentId: "pi_...",
    eventId: "evt_...",
    invoiceId: "optional-invoice-id",
  },
  selectedGenre: "electronic",
  strategyType: "market_discovery",
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log("Created:", data.campaignId, data.smartLinkId);
```

### List organic campaigns

```ts
import { createClient } from "soundlink";

const client = createClient();

const { data, error } = await client.listOrganicCampaigns({
  page: 1,
  pageSize: 25,
  sortBy: "updatedAt",
  sortOrder: "desc",
  status: ["active"],
  platform: ["tiktok"],
  // search: "summer",
  // startDate: "2025-01-01",
  // endDate: "2025-12-31",
  // socialAccountId: "uuid-of-connected-account",
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

for (const c of data.campaigns) {
  console.log(c.id, c.name, c.status, c.stats.publishedPosts);
}
console.log(data.pagination);
```

### Create organic campaign

`startDate` must be a valid date string accepted by the API (not in the past). `userId` is taken from the token, not the body.

```ts
import { createClient } from "soundlink";

const client = createClient();

const { data, error } = await client.createOrganicCampaign({
  socialAccountId: "00000000-0000-0000-0000-000000000002",
  name: "June TikTok calendar",
  spotifyLink: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
  color: "#6366f1",
  dailyPostsQuantity: 2,
  startDate: "2025-06-01T12:00:00.000Z",
  endDate: "2025-06-30T23:59:59.000Z",
  timeZone: "Europe/Lisbon",
  creativeTag: ["viral", "dance"],
  captionType: ["hook_first"],
  language: "en",
  initialPostSettings: {
    title: "New drop",
    description: "Stream now",
    shareToFeed: true,
    trialGraduationStrategy: "MANUAL",
  },
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log("Calendar id:", data.calendarId);
```

### Flat imports (environment variables only)

Set `SOUNDLINK_TOKEN`, `SOUNDLINK_ORGANIZATION_ID`, and `SOUNDLINK_BASE_URL`, then:

```ts
import {
  createOrganicCampaign,
  createPaidCampaign,
  listOrganicCampaigns,
  listPaidCampaigns,
} from "soundlink";

const paid = await listPaidCampaigns({ page: 1, pageSize: 10 });
if (paid.error) throw paid.error;

const organic = await listOrganicCampaigns({ page: 1, pageSize: 10 });
if (organic.error) throw organic.error;

const created = await createPaidCampaign({
  spotifyLink: "https://open.spotify.com/track/...",
  dailyBudget: 40,
  campaignDuration: 7,
  smartLinkName: "Quick test",
  createdBy: "user-uuid-here",
});
if (created.error) throw created.error;
```

---

## API methods reference

All methods return `Promise<Result<...>>` (see [Return values & errors](#return-values--errors)).

### Paid campaigns

| Method                              | HTTP                             | Description                                                                                                                                                                                    |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPaidCampaign(input)`         | `POST /api/v1/campaigns/managed` | Creates a **managed** paid campaign (same payload shape as the app’s managed flow). **Production note:** the backend may require a CSM user and invoice billing; otherwise it returns **403**. |
| `createCheckoutPaidCampaign(input)` | `POST /api/v1/campaigns`         | Creates a campaign **after Stripe checkout**; requires `paymentInfo` (`sessionId`, `paymentIntentId`, `eventId`, …).                                                                           |
| `listPaidCampaigns(query?)`         | `GET /api/v1/campaigns`          | Paginated list for the current organization.                                                                                                                                                   |

### Organic growth (calendars)

| Method                         | HTTP                                    | Description                                                                           |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------- |
| `createOrganicCampaign(input)` | `POST /api/v1/organic-growth/campaigns` | Creates an organic “campaign” (calendar). User id comes from the token, not the body. |
| `listOrganicCampaigns(query?)` | `GET /api/v1/organic-growth/campaigns`  | Filterable list (`status`, `platform`, dates, search, pagination, sort).              |

---

## Types & payloads

Exported types live in the package entry (e.g. `CreateManagedPaidCampaignInput`, `ListOrganicCampaignsQuery`). Highlights:

### Managed paid create (`createPaidCampaign`)

Required fields (enforced by the API):

- `spotifyLink`, `dailyBudget`, `campaignDuration`, `smartLinkName`, `createdBy`

Optional (among others):

- `selectedGenre`
- `strategyType` — **paid only**; allowed values:  
  `maximum_growth` | `market_discovery` | `revenue_maximization` | `custom` | `custom_default` | `custom_localized`  
  (see exported `STRATEGY_TYPES` / `StrategyType`)
- `platform`: `"meta"` | `"tiktok"`
- `customTierIds`, `customTiers`, `creativeStrategyTag`, `creativeStrategyTags`, `audioUri`, `captionTypes`, `creativeDirectionType`, `selectedCreatives`

Success body: `{ campaignId, smartLinkId }`.

### Checkout paid create (`createCheckoutPaidCampaign`)

Requires `paymentInfo` plus the same core fields as the non-managed `POST /campaigns` flow. See type `CreateCheckoutPaidCampaignInput`.

### List paid (`listPaidCampaigns`)

Query object `ListPaidCampaignsQuery`:

- `page`, `pageSize`, `sortBy`, `sortOrder`

Response shape: `ListPaidCampaignsResponse` (`items`, `total`, `page`, `pageSize`, optional `totalPages`).

### Organic create (`createOrganicCampaign`)

Required by the API: `socialAccountId`, `name`, `spotifyLink`, `color`, `dailyPostsQuantity`, `startDate`.  
Optional: `endDate`, `timeZone`, `timeDailyConfigs`, `creativeTag`, `captionType`, `audioUri`, `language`, `initialPostSettings`.

There is **no** paid-style `strategyType` on organic create. TikTok-related `initialPostSettings.trialGraduationStrategy` is separate (`MANUAL` | `SS_PERFORMANCE` per API validation).

Success: `{ calendarId }` (HTTP 201).

### List organic (`listOrganicCampaigns`)

`ListOrganicCampaignsQuery` supports e.g.:

- `status` — array of `active` | `inactive` | `ended` | `archived` (sent as comma-separated query)
- `platform` — `tiktok` | `instagram` (comma-separated)
- `socialAccountId`, `startDate`, `endDate`, `search`, `page`, `pageSize`, `sortBy`, `sortOrder`

Response: `ListOrganicCampaignsResponse` (`campaigns`, `pagination`).

---

## Return values & errors

Every public method returns a **discriminated result**:

```ts
type Result<T> =
  | { data: T; error: null }
  | { data: null; error: SoundlinkError };
```

**Do not rely on thrown exceptions** for API failures; check `error`.

```ts
import {
  AuthenticationError,
  PermissionError,
  SoundlinkError,
  ValidationError,
  listPaidCampaigns,
} from "soundlink";

const { data, error } = await listPaidCampaigns();

if (error) {
  if (error instanceof AuthenticationError) {
    /* 401 */
  } else if (error instanceof PermissionError) {
    /* 403 */
  } else if (error instanceof ValidationError) {
    /* 4xx validation-style */
  } else if (error instanceof SoundlinkError) {
    console.error(error.code, error.status, error.message);
  }
  return;
}

// data is defined here
console.log(data.items);
```

Exported error classes include: `AuthenticationError`, `PermissionError`, `ValidationError`, `NotFoundError`, `RateLimitError`, `ServerError`, `NetworkError`, and base `SoundlinkError`.

Helpers: `ok()`, `err()` from `"soundlink"` if you compose your own logic.

---

## Advanced

### Low-level HTTP helpers

If you share one `SoundlinkHttpClient` instance, you can call the same operations as functions:

- `createPaidCampaignWithHttp`, `createCheckoutPaidCampaignWithHttp`, `listPaidCampaignsWithHttp`
- `createOrganicCampaignWithHttp`, `listOrganicCampaignsWithHttp`

Useful for custom wiring; most apps should use `SoundlinkClient` or the flat exports.

### Config inspection / validation

- `resolveSoundlinkConfig(partial?)` → `ResolvedSoundlinkConfig`
- `assertConfigReady(config)` — throws if token, org, or base URL is missing

### `SoundlinkHttpClient`

Direct use is rare; it implements JSON requests, timeout, headers, and error mapping.

---

## Examples

See the [`examples/`](./examples/) directory:

- [`examples/README.md`](./examples/README.md) — how to build and run
- [`examples/.env.example`](./examples/.env.example) — required env vars
- Sample scripts (e.g. list paid campaigns) using `node --env-file=examples/.env ...`

---

## Scripts (package root)

| Command             | Description                       |
| ------------------- | --------------------------------- |
| `npm run build`     | Bundle ESM + CJS + types (`tsup`) |
| `npm run typecheck` | `tsc --noEmit`                    |
| `npm run dev`       | Watch mode                        |
| `npm run clean`     | Remove `dist/`                    |

---

## License

Proprietary — Soundlink / Fan ID (use according to your organization’s policies).

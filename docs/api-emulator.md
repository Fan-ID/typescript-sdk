# Public API emulator

Local, stateful stand-in for the Soundlink Public API. Use it in automated tests for wallet campaign flows without Meta spend or a hosted sandbox.

Import: `soundlink/api-emulator` (not re-exported from `soundlink`).

Works with the SDK **or** plain `fetch` / curl — anything that can hit HTTP on the same machine.

## Quick start (SDK)

```ts
import { Soundlink } from 'soundlink';
import { createApiEmulator } from 'soundlink/api-emulator';

const apiKey = 'sk_emulator_test';
const emu = createApiEmulator({
  apiKey,
  initialWalletBalance: 500,
  plan: 'enterprise', // optional — sets the paid-campaign fee
});

const server = await emu.listen(); // 127.0.0.1 only
const soundlink = new Soundlink({ apiKey, baseUrl: server.baseUrl });

const { data: created } = await soundlink.campaigns.create(
  {
    spotifyUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
    dailyBudget: 10,
    durationDays: 7,
    genre: 'Pop',
    strategyType: 'maximum_growth',
  },
  { idempotencyKey: 'demo-1' },
);

await emu.transition(created!.campaignId, 'activate');
await soundlink.metrics.overview(created!.campaignId);
await soundlink.campaigns.stop(created!.campaignId, {
  idempotencyKey: 'stop-1',
});

await server.close();
```

Same lifecycle without TCP: `emu.dispatch({ method, path, headers, body })`.

## Use from another process (fetch / curl)

`listen` is a normal HTTP server on **loopback only**. Fix the port, keep the process alive, call it from any other local codebase — no SDK required on the client side.

**Process A** (starts the emulator — needs `soundlink`):

```ts
import { createApiEmulator } from 'soundlink/api-emulator';

const apiKey = 'sk_emulator_test';
const emu = createApiEmulator({
  apiKey,
  initialWalletBalance: 500,
  plan: 'enterprise',
});
const server = await emu.listen({ port: 8787 });
console.log(`api-emulator at ${server.baseUrl}`);
// leave this process running
```

**Process B** (your app, tests, curl — same machine):

```ts
const base = 'http://127.0.0.1:8787';
const apiKey = 'sk_emulator_test';

const created = await fetch(`${base}/v1/campaigns`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': 'demo-1',
  },
  body: JSON.stringify({
    spotifyUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
    dailyBudget: 10,
    durationDays: 7,
    genre: 'Pop',
    strategyType: 'maximum_growth',
  }),
}).then((r) => r.json());

const campaignId = created.data.campaignId;

await fetch(`${base}/__emulator/campaigns/${campaignId}/transition`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'activate' }),
});

await fetch(`${base}/v1/campaigns/${campaignId}`, {
  headers: { Authorization: `Bearer ${apiKey}` },
}).then((r) => r.json());
```

```bash
curl -s http://127.0.0.1:8787/v1/ping -H "Authorization: Bearer sk_emulator_test"
```

Limits: bind is always `127.0.0.1` (not reachable from other machines / default Docker networks without host networking). Harness routes (`/__emulator/*`) have no auth — that is why listen refuses non-loopback hosts.

## Lifecycle

| Step       | How                                                                           |
| ---------- | ----------------------------------------------------------------------------- |
| Create     | `POST /v1/campaigns` — debits `dailyBudget × durationDays`, status `creating` |
| Activate   | harness `activate` → `active` + seeded metrics                                |
| Spend      | harness `set_spend` with `{ mediaSpendUsd }` (0 … committed)                  |
| Stop / end | public `stop` or harness `end` → refunds unspent gross                        |

Wallet after settle: `reserved === 0`, `available === balance`.

## Harness

No auth. Prefer `emu.transition` / `emu.setWallet` / `emu.reset` / `emu.failNext` in-process when you own the Node process.

| Action                    | Effect                                                  |
| ------------------------- | ------------------------------------------------------- |
| `activate`                | `creating` → `active`; seeds overview listeners         |
| `reject_meta`             | → `inactive` **without** refund                         |
| `set_spend`               | sets media spend (before refund)                        |
| `end`                     | → `ended` + refund                                      |
| `disapprove_creatives`    | creatives children report `delivery_state: disapproved` |
| `POST /__emulator/wallet` | `{ balance }` — top-up without clearing campaigns       |
| `POST /__emulator/reset`  | wipe campaigns, idempotency, restore initial balance    |
| `POST /__emulator/fault`  | fail the next authenticated `/v1` calls                 |

```http
POST /__emulator/campaigns/{campaignId}/transition
Content-Type: application/json

{ "action": "set_spend", "mediaSpendUsd": 40 }
```

`failNext` (or `POST /__emulator/fault` with `{ "fault" }`) accepts `timeout`, `conflict`, or `server_error`. `conflict` is one `409 idempotency_key_conflict`. `server_error` is `500 internal_error` for the call plus `maxRetries` (omit it to use the SDK default), then the next call succeeds. Pass the same `maxRetries` the client uses. `timeout` writes nothing on `listen`; in-process `dispatch` returns `hang: true` and status `408`, which is not sent on the socket. A second arm while one is pending is rejected (`failNext` throws; the HTTP route returns `400`). The fault does not change the wallet, and `reset` clears it. A missing API key is still `401` and leaves the fault armed.

## Options

| Option                 | Default            | Notes                                                      |
| ---------------------- | ------------------ | ---------------------------------------------------------- |
| `apiKey`               | `sk_emulator_test` | Must start with `sk_`; same value in SDK / `Authorization` |
| `initialWalletBalance` | `1000`             | USD                                                        |
| `plan`                 | —                  | Sets the paid-campaign fee. See table below                |
| `feeRate`              | `0` (or plan fee)  | Always overrides plan fee; must be in `[0, 1)`             |
| `organizationId`       | `org_emulator`     | Returned on campaign detail                                |

### Plans

Local test presets, not the public price list. Pass `feeRate` when the test needs a specific rate.

| Plan                             | Fee    |
| -------------------------------- | ------ |
| _(omit)_                         | `0`    |
| `free` / `artist_pro` / `studio` | `0.2`  |
| `label_power`                    | `0.15` |
| `enterprise`                     | `0.1`  |

`emu.getPlan()` → fee and premium flag. `premium` is metadata only (does not change `/v1` payloads).

## Recipes

**Insufficient credit (402)** — top up, then retry with a **new** `Idempotency-Key`:

```ts
const low = createApiEmulator({ apiKey, initialWalletBalance: 10 });
await low.listen();
// create with idempotencyKey 'create-1' → 402 insufficient_credit
low.setWallet(500);
// create with idempotencyKey 'create-2' → 201
```

Create `402` does not store the key in this emulator, so the same key would also succeed after `setWallet`. Do not rely on that. The public API can replay a recorded `402`, and the documented retry is a new key.

**Meta reject** — no wallet credit until you stop:

```ts
await emu.transition(id, 'reject_meta'); // inactive, balance unchanged
await soundlink.campaigns.stop(id, { idempotencyKey: 'stop-reject' }); // full refund
```

**Partner-upload creative disapproval** (`delivery_state`, `delivery_reason`):

```ts
await emu.transition(id, 'activate');
await emu.transition(id, 'disapprove_creatives', undefined, 'Spam');
const { data } = await soundlink.metrics.creatives(id);
// data.creatives[0].children[0].delivery_state === 'disapproved'
// data.creatives[0].children[0].delivery_reason === 'Spam'
```

Omit the reason to get `delivery_reason: null` while `delivery_state` stays `disapproved`. A later `disapprove_creatives` call without a reason keeps the reason already set. A blank reason (empty or only spaces) is stored as `null`, and surrounding spaces are trimmed.

**`full_control` creatives** (`creativeDirection`):

```ts
const { data: created } = await soundlink.campaigns.create(
  {
    spotifyUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
    dailyBudget: 10,
    durationDays: 7,
    genre: 'Pop',
    strategyType: 'maximum_growth',
    creativeDirection: {
      type: 'full_control',
      selectedCreatives: [
        { videoId, useEmbeddedVideoAudio: false, caption: 'Hear the preview' },
      ],
    },
  },
  { idempotencyKey: 'full-control-1' },
);

const { data } = await soundlink.metrics.creatives(created!.campaignId);
// data.creatives[0].video_id === videoId
// data.creatives[0].children[0].caption === 'Hear the preview'
```

The emulator stores each `selectedCreatives` entry and returns one creative per `videoId`, in order. `useEmbeddedVideoAudio` defaults to `true`. A caption is trimmed, and an empty one means no caption, which the emulator reports as `''`. Campaign totals are reported on the first creative, and the other creatives report zeros, so the sum across creatives matches the overview. Per-creative delivery is not simulated. Campaigns without `full_control` keep the placeholder creative.

**Auto-renew and batch overview**:

```ts
await emu.transition(id, 'activate'); // harness, or use an existing helper
await soundlink.campaigns.updateAutoRenew(
  id,
  { autoRenew: true },
  { idempotencyKey: 'auto-renew-1' },
);
const { data } = await soundlink.metrics.overviewBatch({ campaignIds: [id] });
// data.items[0].campaignId === id
```

`PUT /v1/campaigns/:id/auto-renew` is accepted only while the campaign is `active` or `renew_failed`. Setting the stored value again is a no-op success. `POST /v1/campaigns/metrics/overview/batch` returns one overview per ID, in request order. Duplicate IDs are ignored, unknown IDs are omitted, and the request is rejected above 50 IDs. `startDate` and `endDate` are validated as `YYYY-MM-DD`, but the emulator returns lifetime totals either way, the same as the single-campaign overview.

**Partial spend + fee**:

```ts
const emu = createApiEmulator({
  apiKey,
  plan: 'enterprise',
  initialWalletBalance: 500,
});
// create committed 70 → activate → set_spend(40) → stop
// refund ≈ 25.56; wallet ≈ 455.56
```

## Errors (match Public API)

| Case                                | Status / code                  |
| ----------------------------------- | ------------------------------ |
| Missing / empty Idempotency-Key     | `400 invalid_request`          |
| Idempotency-Key > 255 chars         | `400 invalid_request`          |
| Same key, different body            | `409 idempotency_key_conflict` |
| `dailyBudget` below 10              | `422 invalid_daily_budget`     |
| Bad `durationDays`                  | `422 invalid_duration_days`    |
| Wallet too low on create            | `402 insufficient_credit`      |
| Bad `full_control` creative         | `400 invalid_request`          |
| Auto-renew on a non-active campaign | `400 invalid_request`          |
| Batch overview over 50 IDs          | `400 invalid_request`          |
| Bad / missing API key               | `401 invalid_api_key`          |

Stop Idempotency-Key hashes `{ campaignId }` only. Stopping while `creating` releases the key (same key works after `activate`).

## Not production

- Default fee is `0` unless you set `plan` / `feeRate`.
- Harness routes are emulator-only.
- `reject_meta` does not refund; public `stop` / harness `end` do.
- Create `402` releases the key (unlike some budget-increase replay paths). Retry with a new key anyway.
- Genre, Spotify URL shape, and `strategyType` are not validated, so a value production would reject with `422` can return `201` here.
- Only a subset of `/v1` is implemented (ping, wallet, strategies, campaigns create/get/list/stop, metrics overview/creatives/creatives batch, pixels list/save/delete/test-events).
- Pixel test-events do not call Meta. A saved pixel returns `200` with `status: "sent"`. Send health stays `ok`. `meta_pixel_conflict` and `pixel_in_use` are not returned: one organization, and soundlinks are not stored. Custom pixels are enabled.

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

| Action                    | Effect                                               |
| ------------------------- | ---------------------------------------------------- |
| `activate`                | `creating` → `active`; seeds overview listeners      |
| `reject_meta`             | → `inactive` **without** refund                      |
| `set_spend`               | sets media spend (before refund)                     |
| `end`                     | → `ended` + refund                                   |
| `POST /__emulator/wallet` | `{ balance }` — top-up without clearing campaigns    |
| `POST /__emulator/reset`  | wipe campaigns, idempotency, restore initial balance |
| `POST /__emulator/fault`  | fail the next authenticated `/v1` call once          |

```http
POST /__emulator/campaigns/{campaignId}/transition
Content-Type: application/json

{ "action": "set_spend", "mediaSpendUsd": 40 }
```

`failNext` (or `POST /__emulator/fault` with `{ "fault" }`) accepts `timeout`, `conflict`, or `server_error`. `conflict` is `409 idempotency_key_conflict`. `server_error` is `500 internal_error`. `timeout` writes nothing; the client must abort. The fault runs once, does not change the wallet, and `reset` clears it. A missing API key is still `401` and leaves the fault armed.

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

| Case                            | Status / code                  |
| ------------------------------- | ------------------------------ |
| Missing / empty Idempotency-Key | `400 invalid_request`          |
| Idempotency-Key > 255 chars     | `400 invalid_request`          |
| Same key, different body        | `409 idempotency_key_conflict` |
| `dailyBudget` below 10          | `422 invalid_daily_budget`     |
| Bad `durationDays`              | `422 invalid_duration_days`    |
| Wallet too low on create        | `402 insufficient_credit`      |
| Bad / missing API key           | `401 invalid_api_key`          |

Stop Idempotency-Key hashes `{ campaignId }` only. Stopping while `creating` releases the key (same key works after `activate`).

## Not production

- Default fee is `0` unless you set `plan` / `feeRate`.
- Harness routes are emulator-only.
- `reject_meta` does not refund; public `stop` / harness `end` do.
- Create `402` releases the key (unlike some budget-increase replay paths). Retry with a new key anyway.
- Genre, Spotify URL shape, and `strategyType` are not validated, so a value production would reject with `422` can return `201` here.
- Only a subset of `/v1` is implemented (ping, wallet, strategies, campaigns create/get/list/stop, metrics overview).

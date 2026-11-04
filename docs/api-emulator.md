# Public API emulator

Local, stateful stand-in for the Soundlink Public API. Test wallet campaign flows without Meta spend or a hosted sandbox.

Import: `soundlink/api-emulator` (not re-exported from `soundlink`).

Works with the SDK **or** plain `fetch` / curl — anything that can hit HTTP on the same machine.

## Quick start (SDK)

```ts
import { Soundlink } from 'soundlink';
import { createEmulator } from 'soundlink/api-emulator';

const apiKey = 'sk_emulator_test';
const emu = createEmulator({
  apiKey,
  initialWalletBalance: 500,
  plan: 'enterprise', // optional — sets fee (+ self-serve caps when applicable)
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
import { createEmulator } from 'soundlink/api-emulator';

const apiKey = 'sk_emulator_test';
const emu = createEmulator({ apiKey, initialWalletBalance: 500, plan: 'enterprise' });
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

No auth. Prefer `emu.transition` / `emu.setWallet` / `emu.reset` in-process when you own the Node process.

| Action                    | Effect                                               |
| ------------------------- | ---------------------------------------------------- |
| `activate`                | `creating` → `active`; seeds overview listeners      |
| `reject_meta`             | → `inactive` **without** refund                      |
| `set_spend`               | sets media spend (before refund)                     |
| `end`                     | → `ended` + refund                                   |
| `POST /__emulator/wallet` | `{ balance }` — top-up without clearing campaigns    |
| `POST /__emulator/reset`  | wipe campaigns, idempotency, restore initial balance |

```http
POST /__emulator/campaigns/{campaignId}/transition
Content-Type: application/json

{ "action": "set_spend", "mediaSpendUsd": 40 }
```

## Options

| Option                 | Default            | Notes                                                      |
| ---------------------- | ------------------ | ---------------------------------------------------------- |
| `apiKey`               | `sk_emulator_test` | Must start with `sk_`; same value in SDK / `Authorization` |
| `initialWalletBalance` | `1000`             | USD                                                        |
| `plan`                 | —                  | Sets fee (+ self-serve listener cap). See table below      |
| `feeRate`              | `0` (or plan fee)  | Always overrides plan fee; must be in `[0, 1)`             |
| `organizationId`       | `org_emulator`     | Returned on campaign detail                                |

### Plans

| Plan                             | Fee    | Self-serve cap  |
| -------------------------------- | ------ | --------------- |
| _(omit)_                         | `0`    | —               |
| `free` / `artist_pro` / `studio` | `0.2`  | —               |
| `label_power`                    | `0.15` | —               |
| `enterprise`                     | `0.1`  | —               |
| `self_serve_5000`                | `0.2`  | 5000 listeners  |
| `self_serve_25000`               | `0.2`  | 25000 listeners |

`emu.getPlan()` → fee, premium flag, remaining listeners. `premium` is metadata only (does not change `/v1` payloads).

Self-serve: each `activate` consumes seeded listeners; when exhausted, further `activate` calls fail with `400`.

## Recipes

**Insufficient credit (402)** — create releases the Idempotency-Key:

```ts
const low = createEmulator({ apiKey, initialWalletBalance: 10 });
await low.listen();
// create → 402 insufficient_credit
low.setWallet(500);
// same Idempotency-Key → 201
```

**Meta reject** — no wallet credit until you stop:

```ts
await emu.transition(id, 'reject_meta'); // inactive, balance unchanged
await soundlink.campaigns.stop(id, { idempotencyKey: 'stop-reject' }); // full refund
```

**Partial spend + fee**:

```ts
const emu = createEmulator({ apiKey, plan: 'enterprise', initialWalletBalance: 500 });
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
- Harness routes and self-serve listener caps are emulator-only.
- `reject_meta` does not refund; public `stop` / harness `end` do.
- Create `402` releases the key (unlike some budget-increase replay paths).
- Only a subset of `/v1` is implemented (ping, wallet, strategies, campaigns create/get/list/stop, metrics overview).

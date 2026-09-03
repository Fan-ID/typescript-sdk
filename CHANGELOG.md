# soundlink

## 2.2.0

### Minor Changes

- [#14](https://github.com/Fan-ID/lib/pull/14) [`6c562f8`](https://github.com/Fan-ID/lib/commit/6c562f8c323309b649f3f29438924e2901affd50) Thanks [@jotanarciso](https://github.com/jotanarciso)! - Align self-serve soundlink metrics with the campaign-parity Public API. ([SOU-6696](https://linear.app/getsoundlink/issue/SOU-6696))

  - Add `soundlinks.breakdown.list` / `.export` / `.export.collect` (`soundlink_country_daily`)
  - Add `soundlinks.engagement.list` / `.export` / `.export.collect` (`soundlink_engagement_daily`)
  - Remove `soundlinks.metricsTimeseries` and the top-tracks `soundlinks.engagement()` helper
  - Fix `SoundlinkMetricsOverview` types (no new/returning splits on overview)

## 2.1.0

### Minor Changes

- [#11](https://github.com/Fan-ID/lib/pull/11) [`9429f58`](https://github.com/Fan-ID/lib/commit/9429f58799d8fcf4bb53701dec4d3c87dabf2e30) Thanks [@jotanarciso](https://github.com/jotanarciso)! - Add self-serve soundlinks API methods (`list`, `get`, `metricsOverview`, `metricsTimeseries`, `engagement`) with TypeScript types. Requires `soundlinks:read`.

## 2.0.0

### Major Changes

- [#SOU-6455](https://linear.app/getsoundlink/issue/SOU-6455) — **Breaking:** the SDK sends `Authorization: Bearer sk_...` instead of the deprecated `x-api-key` header. Constructor API is unchanged (`new Soundlink({ apiKey })`). Migrate by upgrading the package; no code changes required unless you were reading request headers in tests or proxies that expected `x-api-key`.

## 1.2.0

### Minor Changes

- [#3](https://github.com/Fan-ID/lib/pull/3) [`279a718`](https://github.com/Fan-ID/lib/commit/279a718eb13c19d57e6f0db2e3a9fbb29af0b0a8) Thanks [@jotanarciso](https://github.com/jotanarciso)! - Add Public API write surface: strategies catalog, campaign create / stop / budget / tiers with `Idempotency-Key`, `generation` on campaign types, expanded error codes. Remove unshipped `metrics.engagement.list`. Sync OpenAPI to the current v1 contract. ([SOU-6003](https://linear.app/getsoundlink/issue/SOU-6003))

## 1.1.1

### Patch Changes

- [`57ed16a`](https://github.com/Fan-ID/lib/commit/57ed16a090e91297845608935cbec8c074d6e15c) Thanks [@jotanarciso](https://github.com/jotanarciso)! - Add TSDoc comments on public methods and types for IDE hover hints and IntelliSense.

## 1.1.0

### Minor Changes

- First official TypeScript SDK release for the Soundlink Public API
- Campaigns: list, get, and `listAll` pagination helper
- Metrics: overview, breakdown, engagement (spec-ready), and JSONL exports with stream + `collect()`
- `{ data, error, meta }` response pattern on all methods
- Node.js 18+ and Edge Runtime support (native `fetch`)

> **Note:** `1.0.0` on npm was an empty placeholder. Use `>=1.1.0` for the SDK.

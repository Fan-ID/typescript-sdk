# soundlink

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

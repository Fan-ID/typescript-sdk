# soundlink

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

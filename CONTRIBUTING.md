# Contributing to soundlink

Thank you for contributing to the official Soundlink TypeScript SDK.

## Development setup

```bash
npm install
npm run dev      # watch build
npm test         # unit tests (MSW)
npm run test:coverage
```

## Project structure

```
src/
├── client/       # Soundlink class + HTTP layer
├── core/         # envelope parsing, JSONL
├── resources/    # ping, campaigns, metrics
├── types/        # public TypeScript types
├── errors/       # SDK-only exceptions
└── utils/
```

## Conventions

- **API errors** → return `{ data, error }`, never throw
- **SDK errors** (config, parse, transport) → throw `SoundlinkSdkError` subclasses
- **Strict TypeScript** — no `any`
- **Conventional Commits** — enforced by commitlint
- **Changesets** — add a changeset for user-facing changes

## Adding a changeset

```bash
npx changeset
```

Choose patch/minor/major and describe the change.

## Syncing types from OpenAPI

When the Public API spec changes in the backend:

1. Copy `backend/specs/public-api/soundlink-public-api-v1.yaml` to `openapi/`
2. Update hand-written types in `src/types/api.ts` if needed
3. Optionally run `npm run generate:types` for reference types
4. Add MSW handlers and tests for new endpoints

## Pull request checklist

- [ ] Tests pass (`npm test`)
- [ ] Types check (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Changeset added (if releasing)
- [ ] README updated for new public API surface

## Release process

Releases are automated via GitHub Actions + Changesets on merge to `main`:

1. Changesets opens a "Version packages" PR
2. Merging that PR triggers npm publish + GitHub Release

Requires `NPM_TOKEN` secret in the repository.

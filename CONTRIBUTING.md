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

Choose the bump type and describe the change:

| Change type     | Changeset bump | Changelog section |
| --------------- | -------------- | ----------------- |
| New feature     | **minor**      | Minor Changes     |
| Bug fix         | **patch**      | Patch Changes     |
| Breaking change | **major**      | Major Changes     |

Reference PRs/issues in the changeset summary — they become links in `CHANGELOG.md` and in the GitHub Release body (via `@changesets/changelog-github`).

Example changeset summary:

```markdown
Add `campaigns.listAll` pagination helper. ([#42](https://github.com/Fan-ID/lib-sdk/pull/42))
```

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

1. Merge PRs that include a changeset file in `.changeset/`
2. CI opens a **"Version packages"** PR — updates `package.json` + `CHANGELOG.md`
3. Merge that PR → CI publishes to npm and creates a **GitHub Release** with the changelog section as the release notes

Requires `NPM_TOKEN` in repository secrets. `GITHUB_TOKEN` is provided automatically for release creation.

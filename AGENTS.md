# AGENTS.md

Index for AI coding agents working in the **Soundlink TypeScript SDK** (`soundlink` on npm). When updating this file, keep it short (index only).

## Public repository — privacy

This repository is **public**. Do not put private or sensitive information in commits, PR titles/bodies, code comments, docs, changesets, or examples.

Never name:

- Customers, partners, or prospects (e.g. who is integrating or evaluating)
- Internal deals, contracts, or “working with X” context
- Non-public pricing nuances beyond what is already on the public pricing site
- Internal service names, private Linear details that identify parties, or credentials

Use generic wording: “API consumers”, “integrators”, “local tests”. Put customer-specific context in private channels (Linear private fields, Slack, internal docs) — not in this repo.

## Development commands

- `npm test` — Vitest
- `npm run build` — tsup (SDK + `soundlink/api-emulator`)
- `npm run typecheck` / `npm run lint` / `npm run format`

## Architecture

- Main entry: `soundlink` — Public API client
- Opt-in: `soundlink/api-emulator` — local loopback Public API stand-in for lifecycle tests (see [docs/api-emulator.md](./docs/api-emulator.md))
- OpenAPI: `openapi/soundlink-public-api-v1.yaml`

## Where knowledge lives

Product and engineering docs: [engineering-os](https://github.com/Fan-ID/engineering-os) (private). Prefer Sync knowledge base when available; do not copy private customer context into this public tree.

@STANDARDS.md

# Scrum Master

You orchestrate agents across `../monitiv-frontend` and `../monitiv-gateway`. Work flows in reverse: build the frontend from an Artifact against contract-shaped dummy data first, then build the backend that makes it real. This repo is public and holds tooling only.

## Stages

Advance a task only when its exit criterion holds:

1. `capture`: share link, Artifact source and viewports in `artifacts/<feature>/`; ticket markdown in `tickets/`.
2. `contract`: gateway drafts path and schema in `api/openapi.yaml` on a branch; frontend runs `gen:api`.
3. `build`: Artifact ported to Svelte 5 + Tailwind v4, reusing `@monitiv/ui` and `@monitiv/features` first. Dummy data is a typed fixture against the generated types behind a `FEATURE_*` flag (the `mock-community-alerts.ts` pattern).
4. `verify`: pixel-diff passes; behavior matches the Artifact source; `pnpm check`, `pnpm lint`, `pnpm test` pass.
5. `data-needs`: every fixture field needing real data has a board entry.
6. `backend`: gateway implements the spec until `TestRoutesMatchOpenAPI` and `make test` pass; the flag flips to live data.
7. `done`

## Team

- Small work: do it yourself or use one subagent.
- Complex single-repo work: one `team-lead` teammate.
- Parallel frontend + backend: two `team-lead` teammates, who message each other on any `openapi.yaml` change.
- Depth stops at developer/tester/reviewer.
- Every spawn brief names the target repo and the absolute path of this repo's `STANDARDS.md`.

## Board

Only you write the board; team-leads report progress, blockers and data needs to you.

```
node bin/board.mjs add tasks title="Alerts page" repo=both
node bin/board.mjs set T1 stage=build
node bin/board.mjs add dataNeeds task=T1 field=alert.severity shape=enum likelySource=gateway
node bin/board.mjs add blockers task=T1 question="Paging size?" askWho=PM
node bin/board.mjs move T1 0
node bin/board.mjs list --open
```

## Rules

- If a task needs real patient data, stop and tell the user to switch to the work laptop. Data needs describe shape and source, never values.
- Inside a sibling repo, its CLAUDE.md governs process.
- Use Node scripts, not OS-specific shell commands.

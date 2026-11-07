@STANDARDS.md

# Scrum Master

You orchestrate agents across `../monitiv-frontend` and `../monitiv-gateway`. Work flows in reverse: build the frontend from an Artifact against contract-shaped dummy data first, then build the backend that makes it real. This repo is public and holds tooling only.

## Stages

Advance a task only when its exit criterion holds:

1. `capture`: share link, Artifact source and viewports in `artifacts/<feature>/`; ticket markdown in `tickets/`.
2. `contract`: gateway drafts path and schema in `api/openapi.yaml` on a branch; frontend runs `gen:api`.
3. `build`: Artifact ported to Svelte 5 + Tailwind v4, reusing `@monitiv/ui` and `@monitiv/features` first. Dummy data is a typed fixture against the generated types behind a `FEATURE_*` flag (the `mock-community-alerts.ts` pattern).
4. `verify`: pixel diff and behavior match the Artifact; `node bin/gate.mjs <worktree>` passes.
5. `data-needs`: every fixture field needing real data has a board entry.
6. `backend`: gateway implements the spec until `node bin/gate.mjs <worktree>` passes; the flag flips to live data.
7. `done`

## Team

Pick a lane when the user approves the plan; lanes only move up.

| Lane | Fits when | Agents |
|---|---|---|
| S | One package, ≤~150 lines, no contract or shared state | 1 developer, then a reviewer |
| M | One repo, one PR | Sequential developer passes of ≤~400 lines, a tester, then a reviewer; no lead. After a shared base unit is reviewed and accepted, disjoint-file units may run as ≤3 parallel developers, each in its own worktree branched from the accepted base unit; if a worktree cannot be created (e.g. the orchestrator session is pinned to a worktree), run the units sequentially in one worktree instead. |
| L | >1 PR, both repos, or an `openapi.yaml` change | One `team-lead` per repo |

- Write the task to `tickets/tasks/<id>.md`; its checklist (with SHAs) is the task state. Brief every helper with `node bin/brief.mjs <role> <task-file>` and use the `MODEL:` it prints. Reports are named `<id>-<role>.md`, so give each developer pass its own task id.
- Accept work only on `node bin/gate.mjs <worktree>` exit 0 plus a reviewer PASS; a self-report is never the gate. Check `.superpowers/stop-gate/*.failed` after each developer.
- Never read delegated code. At most 3 long-running agents at once, parallel developers included; after a 402, run everything sequentially. Run the orchestrator in the foreground in iTerm2 or tmux and spawn your helpers as named teammates so each gets a visible pane; a background-job orchestrator puts teammates on a detached tmux server instead.

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

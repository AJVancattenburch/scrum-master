---
paths:
  - "tickets/HANDOFF.md"
  - "tickets/handoffs/**"
---
# Hand-off files

A hand-off lets a fresh session with no other context resume the work. It is a snapshot of the current state, not a log. History belongs in git, PR pages, the board and the task file's Steps.

## Reading
- Resuming a named task: read only `tickets/handoffs/<id>.md`, then the files it points to.
- `tickets/HANDOFF.md` is the cross-task index. Read it only to choose what's next.

## Writing a task hand-off (`tickets/handoffs/<id>.md`)
Keep it to these sections, about 40 lines, and overwrite them in place:

```
# <id> hand-off
Updated <YYYY-MM-DD>; later work may be missing (check `git log` and PR pages).
## Goal       one or two lines; what "done" means
## State      branch, worktree, HEAD SHA, last gate result, PR numbers, what's accepted
## Next       ordered steps; step 1 is actionable now; open rulings with a recommendation
## Waiting on others   who, which item (camp ID), what it unblocks
## Rulings    pointers to the task files that hold them; never copies
## Follow-ups items found but out of scope
```

- Never append "RESUME HERE" or dated blocks. Update the section that changed; a superseded line is deleted, not marked.
- Only verifiable facts: SHAs, PR and camp numbers, paths, dates. No narrative, no tool-call history, no record of who said what beyond a ruling and its date.
- Rulings go in the task file (`tickets/tasks/<id>.md`); the hand-off points to them.
- Update it when a unit is accepted, at a task boundary, and before `/compact`.
- When the task is done, replace the file with a three-to-five-line DONE summary (PRs, merge SHAs, open follow-ups). If old content still matters, move it to `tickets/archive/handoffs/` rather than keeping it here.

## Writing the index (`tickets/HANDOFF.md`)
Only the session that owns the board writes it. Keep it to about 50 lines: context that crosses tasks, one pointer line per active task, next candidates, open camp items and rules in force. No done tasks (the board has them), and no backlogs: those live in `tickets/tooling-backlog.md` and `tickets/frontend-backlog.md`.

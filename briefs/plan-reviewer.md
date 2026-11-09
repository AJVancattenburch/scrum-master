You are the plan reviewer for task {{id}} in `{{repo}}`, lane {{lane}}. Review the plan below before any developer starts. There is no diff yet. Do not edit anything in `{{worktree}}`.

Read these first. They decide where every file belongs:
{{readFirst}}

Check every rule below explicitly, from `{{standardsPath}}`:
{{standards}}

The plan:
{{task}}

FAIL the plan if any of these hold:
- A path it creates or moves does not cite the rule (doc, section and rule) from the docs under Read these first that places it there.
- A path it creates or moves has no precedent: an existing file of the same kind in the same directory or layer on `{{baseRef}}`. Confirm each cited precedent with `git -C {{worktree}} ls-tree --name-only {{baseRef}}` followed by the literal directory path and a trailing slash. A precedent that is missing on `{{baseRef}}` is a FAIL.
- {{laneCheck}}
- The plan adds a function, component or type without naming the existing code it searched and why that code does not fit.
- The plan does work the task's Goal does not ask for.

Run each command exactly as written; do not compose shell variables, pipes or loops.

Stop and report instead of continuing if:
{{escalations}}

Write your full review with the Write tool to `{{reportPath}}`: PASS or FAIL on the first line, then one line per new or moved path (`path: rule — precedent — ok` or `path: problem — fix`), then the lane line, then one line per standard in the same form.
Then return at most 15 lines: PASS or FAIL first, then the failing findings. The last line must be exactly:
REPORT: {{reportPath}}

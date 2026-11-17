# Cleanup (one-time, on the Dell)

Paste everything below the line into Claude Code, started with `bin/start` from this repo inside WSL.

---

Verify this repo against the current Claude Code docs at https://code.claude.com/docs and a live run. Read `CLAUDE.md`, `STANDARDS.md`, `README.md`, `.claude/settings.json`, `.claude/agents/*.md` and `bin/start` first. Check each item, record the evidence, and apply only the minimal fix for any mismatch:

1. Teammate starting cwd: spawn one `team-lead` teammate and have it report `pwd`. If it is not this repo's root, fix any relative paths in `CLAUDE.md` and `.claude/agents/*.md`.
2. Have that teammate spawn one `developer` subagent and confirm it reports this repo's root as its cwd and that its `SubagentStop` stop gate fires.
3. `permissions.additionalDirectories` lets teammates read `../monitiv-frontend` and `../monitiv-gateway`: have the teammate list each one's root.
4. The README Windows steps work end to end on this machine, including that teammate panes split inside the one Windows Terminal window (not new windows) and that panes are clickable. Fix any step that fails.

Keep `CLAUDE.md` + `STANDARDS.md` under 80 lines combined. Then:

```sh
npm test
git rm CLEANUP.md
git diff HEAD --numstat
```

Justify each file's growth, stage only the files you changed by explicit path, and commit with a `chore:` message that lists each finding.

# Cleanup (one-time, on the Dell)

Paste everything below the line into Claude Code, started with `bin/start` from this repo inside WSL.

---

Verify this repo against the current Claude Code docs at https://code.claude.com/docs and a live run. Read `CLAUDE.md`, `STANDARDS.md`, `README.md`, `.claude/settings.json`, `.claude/agents/*.md` and `bin/start` first. Check each item, record the evidence, and apply only the minimal fix for any mismatch:

1. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json` is still the way to enable agent teams.
2. `bin/start` passes `--teammate-mode tmux`. Confirm the flag exists and whether a `teammateMode` settings key should replace it. If the key is preferred, move it to `.claude/settings.json`, simplify `bin/start`, and update the README's note that teammates run in-process unless launched via `bin/start`.
3. Teammate starting cwd: spawn one `team-lead` teammate and have it report `pwd`. If it is not this repo's root, fix any relative paths in `CLAUDE.md` and `.claude/agents/*.md`.
4. Whether teammates can spawn subagents: have that teammate spawn one `developer` subagent that reports its cwd. If it cannot, rewrite `.claude/agents/team-lead.md` and the Team section of `CLAUDE.md` so developer/tester/reviewer are always flat teammates the orchestrator spawns on the lead's request.
5. `permissions.additionalDirectories` lets teammates read `../monitiv-frontend` and `../monitiv-gateway`: have the teammate list each one's root.
6. The README Windows steps work end to end on this machine, including that teammate panes split inside the one Windows Terminal window (not new windows) and that panes are clickable. Fix any step that fails.

Keep `CLAUDE.md` + `STANDARDS.md` under 80 lines combined. Then:

```sh
npm test
git rm CLEANUP.md
git diff HEAD --numstat
```

Justify each file's growth, stage only the files you changed by explicit path, and commit with a `chore:` message that lists each finding.

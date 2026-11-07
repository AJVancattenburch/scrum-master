# Scrum Master

Tooling-only workspace that orchestrates Claude Code agents across `../monitiv-frontend` and `../monitiv-gateway`.
Work flows in reverse: the frontend is built from an Artifact against contract-shaped dummy data first, then the gateway makes it real.
Stages, team rules and board usage for agents live in `CLAUDE.md`.

## Rules

- **Never put PHI here.** If a task needs real patient data, switch to the work laptop. Data needs describe shape and source, never values.
- **Org content stays gitignored.** `artifacts/`, `tickets/`, `board.json` and `docs/superpowers/` never get committed; only tooling does.

## Setup: macOS

```sh
brew install tmux node
curl -fsSL https://claude.ai/install.sh | bash
```

Clone the three repos side by side, then:

```sh
cd scrum-master
npm i
npx playwright install chromium
bin/start
```

## Setup: Windows (WSL2)

1. Admin PowerShell, then reboot:
   ```powershell
   wsl --install -d Ubuntu
   ```
2. Open Ubuntu from Windows Terminal:
   ```sh
   sudo apt update && sudo apt install -y tmux git
   ```
3. Node LTS via nvm:
   ```sh
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc
   nvm install --lts
   ```
4. Claude Code, inside WSL:
   ```sh
   curl -fsSL https://claude.ai/install.sh | bash
   ```
5. Make tmux panes clickable:
   ```sh
   echo 'set -g mouse on' >> ~/.tmux.conf
   ```
6. Clone the three repos side by side under `~` (not `/mnt/c`):
   ```sh
   cd ~
   git clone https://github.com/AJVancattenburch/scrum-master.git
   git clone <frontend-url> monitiv-frontend
   git clone <gateway-url> monitiv-gateway
   ```
7. Install dependencies:
   ```sh
   cd ~/scrum-master
   npm i && npx playwright install --with-deps chromium
   ```
8. Start. Teammate panes split inside the same Windows Terminal window:
   ```sh
   bin/start
   ```

## Daily use

Start the orchestrator. `bin/start` opens (or reattaches to) the tmux session `scrum-master`, overridable with `SCRUM_MASTER_SESSION`; extra arguments go to `claude`. Teammates get their own tmux panes only when launched this way; a plain `claude` runs them in-process.

```sh
bin/start
```

Open the board at http://localhost:4317 (`node bin/board.mjs serve --port N` for another port). `GET /board.json` returns the tasks, data needs and blockers, plus `stages`.

```sh
npm run board
```

Add an Artifact under `artifacts/<feature>/`:

- `link.txt`: the Artifact share link (required).
- `source.jsx`: the Artifact source.
- `config.json` (optional; defaults shown). `hide` masks selectors in both captures, `remove` takes them out of the layout, and `navigate` clicks selectors in order on the Artifact only:
  ```json
  { "viewports": [{ "width": 1440, "height": 900 }, { "width": 390, "height": 844 }], "threshold": 0.001, "hide": [], "remove": [], "navigate": [] }
  ```

Put ticket markdown in `tickets/`.

Pixel-diff a local route against the Artifact:

```sh
node bin/pixel-diff.mjs <feature> http://localhost:<port>/<route>
```

It prints one line per viewport (`1440x900  0.0123%  PASS  artifacts/<feature>/diff-1440x900.png`) and exits 1 if any viewport fails. The first capture is cached as `baseline-WxH.png`; if the link is unreachable the cached baseline is used and the line ends with `(baseline)`. Delete `baseline-*.png` when the Artifact is intentionally updated.

Brief a helper from a task file (front matter `id`, `repo`, `worktree`, `lane`; optional `feature`, `url`, `complex`). It prints `MODEL: <model>` then the brief:

```sh
node bin/brief.mjs <developer|reviewer|tester|team-lead> tickets/tasks/<id>.md
```

Gate a worktree with its repo's diff-audit, checks and pixel diffs. It prints a short PASS/FAIL summary, writes step logs under `.superpowers/gate/`, and exits 0 pass, 1 fail, 2 input or infrastructure error:

```sh
node bin/gate.mjs <worktree> [--feature <name> --url <url>]...
```

Audit only the comment and file-growth rules against `origin/<baseBranch>` (or a given ref):

```sh
node bin/diff-audit.mjs <worktree> [base-ref]
```

`bin/stop-gate.mjs` runs as the `SubagentStop` hook for developers (`.claude/settings.json`). It blocks a developer whose report lacks a `WORKTREE:` line, whose worktree has uncommitted work, or whose diff-audit fails, up to twice; then it writes `.superpowers/stop-gate/<agent>.failed`.

Run the tests:

```sh
npm test
```

## Dev dependency licenses

| Package    | License    |
| ---------- | ---------- |
| playwright | Apache-2.0 |
| pixelmatch | ISC        |
| pngjs      | MIT        |

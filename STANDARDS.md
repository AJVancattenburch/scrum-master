# Standards

- Comment only when a repo workflow requires it (e.g. the PHI data-classification comment) or the reason can't be recovered from the code. Never restate code.
- Prove reuse before new code: before adding a function, component or type, search the target repo and list what you checked and why it doesn't fit. Extend or extract; never add parallel logic.
- KISS, DRY, SRP: one responsibility per unit. Decompose in-scope functions that do more than one thing. Write nothing speculative.
- Before sign-off, run `git diff --numstat` and justify every file's growth.
- Handle errors explicitly. No bare `catch`, no swallowed errors.

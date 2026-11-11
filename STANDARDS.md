# Standards

- Comment only when a repo workflow requires it (e.g. the PHI data-classification comment) or the reason can't be recovered from the code. Never restate code.
- Prove reuse before new code: before adding a function, component or type, search the target repo and list what you checked and why it doesn't fit. Extend or extract; never add parallel logic.
- KISS, DRY, SRP: one responsibility per unit. Decompose in-scope functions that do more than one thing. Write nothing speculative.
- Before sign-off, run `git diff --numstat` and justify every file's growth.
- Handle errors explicitly. No bare `catch`, no swallowed errors.
- Design data access for scale: fetch on demand (per view or tab, paged), debounce user-driven queries and cancel superseded requests, keep every query bounded (filtered on indexed or clustered keys, no N+1, no unbounded scans), and cache only per user and branch scope with a lifetime tied to the source's load cadence. Never put PHI in a shared or CDN cache or in browser storage. New event, cache, polling or streaming infrastructure needs an orchestrator ruling first. Detail: `tickets/monitiv-home-health.plan.md`, "Data fetching and freshness".

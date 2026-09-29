---
"@vitest-agent/mcp": patch
---

## Refactoring

* `run_tests` finds the Vitest config for its root with `@effected/walker`, bounded at the repository root reported by `@effected/git`, instead of a hand-written directory walk. The lookup rules are unchanged: `vitest.config.*` before `vite.config.*`, the nearest directory wins, and the walk stops at the repository root, including in a linked worktree or a symlinked checkout (#384).
* The logic that derives a run's scope and shapes its `ok` and `no-match` results now lives in pure helpers, separate from the Vitest run lifecycle. Results are unchanged (#336).

## Dependencies

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| @effected/git | dependency | added | — | ^0.18.1 |
| @effected/walker | dependency | added | — | ^0.13.0 |

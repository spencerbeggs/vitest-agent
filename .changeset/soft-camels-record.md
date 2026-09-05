---
"@vitest-agent/cli": patch
---

## Bug Fixes

- `agent record tdd-artifact` gained a `--suite vitest|bats` flag (default `vitest`) so a caller can mark an artifact as coming from a bats run instead of a vitest run — required for `validatePhaseTransition` to accept a bats run-level artifact as evidence (#363).

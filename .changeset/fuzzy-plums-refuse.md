---
"@vitest-agent/sdk": patch
---

## Bug Fixes

- `validatePhaseTransition` now denies `red→refactor`, `red.triangulate→refactor`, and `spike→refactor` with `refactor_without_passing_run` instead of letting the transition through with no evidence the behavior's implementation ever passed. `refactor` may only be entered from `green` or `green.fake-it` (#361).

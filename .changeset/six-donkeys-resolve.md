---
"@vitest-agent/mcp": patch
---

## Bug Fixes

Fixes `tdd_phase_transition_request` artifact auto-resolution picking the newest matching artifact for the whole task, ignoring which behavior it belonged to (#115).

* The lookup is now scoped by `behaviorId` only on transitions where behavior-match binding actually applies (`red→green` and `green→refactor`), using the sdk's `transitionEnforcesBehaviorMatch` predicate.
* `red.triangulate→green` and `refactor→red` remain unscoped, since their evidence legitimately belongs to a different behavior than the one being requested.

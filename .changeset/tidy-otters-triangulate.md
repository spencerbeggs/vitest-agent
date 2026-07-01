---
"@vitest-agent/sdk": minor
---

## Features

Adds phase-transition support for triangulation batches, where a single implementation satisfies several behaviors and only the first produces its own failing run (#115).

* `requiredArtifactForTransition` now requires a `test_failed_run` for `red.triangulate→green` (previously accepted with no evidence at all) — a triangulation batch must still point at a real failing run, just not necessarily the requested behavior's own.
* `validatePhaseTransition` relaxes the phase-window and behavior-match binding rules specifically for `red.triangulate→green`, so a batch's shared failing run can serve as evidence for a later behavior in the same batch.
* New export `transitionEnforcesBehaviorMatch(from, to)` reports whether D2 binding rule 2 (behavior-match) applies to a transition. It is `true` only for `red→green` and `green→refactor`, and `false` for `red.triangulate→green` and `refactor→red` — letting `refactor→red` cross a behavior boundary in one step without a rebind dance.

```ts
import { transitionEnforcesBehaviorMatch } from "@vitest-agent/sdk";

transitionEnforcesBehaviorMatch("red", "green"); // true
transitionEnforcesBehaviorMatch("red.triangulate", "green"); // false
```

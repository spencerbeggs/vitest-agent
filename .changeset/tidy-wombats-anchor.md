---
"@vitest-agent/sdk": minor
---

## Features

- `tdd_artifacts` rows gained an explicit `suite` marker (`"vitest"` | `"bats"`, default `"vitest"`) in the canonical `0001_initial` migration, and `WriteTddArtifactInput` / `CitedArtifact` / `TddArtifactRow` gained a matching `suite` field. This is a pre-2.0 schema change with no migration path — reset an existing local `data.db` with `vitest-agent db reset` (#363).

## Bug Fixes

- `validatePhaseTransition`'s D2 evidence-binding check now accepts a run-level artifact with `suite: "bats"` (`test_case_id` is null, since there is no `test_case` row for a bats test) under the artifact's own phase-window check, instead of denying every run-level artifact outright. A run-level `vitest`-suite artifact is still denied — only bats-suite run-level artifacts can bind evidence without a specific test (#363).

---
"@vitest-agent/ui": minor
---

## Features

- New `buildProjectSummary(name, counts)` helper builds a `ProjectSummary` from a project's rolled-up counts, including `timeoutCount` only when nonzero (#242).

## Bug Fixes

- `formatProjectRow` and `formatWorkspaceTotal` now render "N timed out" per project and in the workspace total, and mark a project carrying timeouts with the ✗ glyph, so a run with timed-out tests no longer reads as a plain pass or an ordinary failure (#242).

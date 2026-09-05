---
"@vitest-agent/mcp": patch
---

## Bug Fixes

- The served schema for `tdd_artifact_list` now carries a `suite` field on each returned artifact row, matching the `@vitest-agent/sdk` `TddArtifactRow` shape (#363).

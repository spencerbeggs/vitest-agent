---
"@vitest-agent/mcp": minor
---

## Bug Fixes

Fixes runtime incompatibility with `effect` `4.0.0-rc.118` and the current `@effected` kit. Published `5.0.1` pins `effect`/`@effect/platform-node`/`@effect/sql-sqlite-node` to `4.0.0-rc.117` and the `@effected/mcp` `0.2.x` range; installed next to a consumer on `rc.118` this fails at import time. This release moves the dependency range to `4.0.0-rc.118` and `@effected/mcp` `^0.3.0`, and renames every `effect/unstable/*` import to its `effect/*` equivalent.

## Features

The `@effected/mcp` `0.3.0` upgrade changes how a tool call with an unrecognized parameter is reported. Every invalid-parameter violation across every level of the input now comes back in a single response instead of surfacing one at a time, and each violation names its path-qualified location, for example:

```text
Invalid parameters for tool 'run_tests': Expected no excess property
  at ["testFiles"]
Accepted params at the root: filter, tags, updateSnapshots
```

A zero-parameter tool now reports `This tool accepts no params.` The key named and the accepted-params list are still present at every level; only the surrounding text format changed from the previous `Unrecognized parameter(s): X. Accepted params: …` shape. An agent parsing that literal string should update its matching to the new format.

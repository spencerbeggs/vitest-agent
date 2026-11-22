---
"@vitest-agent/mcp": minor
---

## Features

- `test_status` entries carry `moduleCache` (fs module cache on or off, transform time and share, modules written) when the project's latest run recorded one, and `test_history` returns a `moduleCache` series of the project's recent runs, newest first, to compare cold and warm runs. `triage_brief` shows the latest stat against the previous run per project.

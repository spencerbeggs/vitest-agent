---
"@vitest-agent/ai-plugins": minor
---

## Features

### Lockfile drift warning

New hooks warn once when the lockfile changes under a running MCP server, so a stale server is restarted instead of failing mysteriously. A fingerprint is taken at SessionStart, re-checked after install commands run through Bash, and as a fallback on each prompt submit.

## Documentation

* The configuration skill's custom-reporter example is rewritten around the real `VitestAgentReporterFactory` surface

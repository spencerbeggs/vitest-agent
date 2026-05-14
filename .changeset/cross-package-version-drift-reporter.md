---
"vitest-agent-reporter": minor
---

## Features

### Cross-package version constants

Exports CURRENT_REPORTER_VERSION, a build-time string constant injected from package.json at compile time. The value is used by vitest-agent-plugin to verify that both packages are at the same version during AgentPlugin initialization.

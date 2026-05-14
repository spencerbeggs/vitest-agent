---
"vitest-agent-mcp": minor
---

## Features

### Cross-package version constants

Exports CURRENT_MCP_VERSION, a build-time string constant injected from package.json at compile time.

Inside main(), the MCP bin compares CURRENT_MCP_VERSION against CURRENT_SDK_VERSION. Any mismatch emits a single namespaced line to stderr in the form "[vitest-agent-mcp] version drift: vitest-agent-sdk@X with vitest-agent-mcp@Y. Reinstall vitest-agent-* packages so versions match." The check is observation-only and never throws or exits.

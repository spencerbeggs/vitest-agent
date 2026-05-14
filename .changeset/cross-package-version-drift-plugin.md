---
"vitest-agent-plugin": minor
---

## Features

### Cross-package version constants

Exports CURRENT_PLUGIN_VERSION, a build-time string constant injected from package.json at compile time.

At AgentPlugin factory initialization, the plugin compares its own version against CURRENT_SDK_VERSION and CURRENT_REPORTER_VERSION. Any mismatch emits a single namespaced line to stderr in the form "[vitest-agent-plugin] version drift: vitest-agent-sdk@X with vitest-agent-plugin@Y. Reinstall vitest-agent-* packages so versions match." The check is observation-only and never throws or exits. The UI peer is intentionally omitted from this check because vitest-agent-ui is wired directly by the user in vitest.config.ts rather than declared as a hard peer dependency.

---
"vitest-agent-sdk": minor
---

## Features

### Cross-package version constants

Exports CURRENT_SDK_VERSION, a build-time string constant injected from package.json at compile time. The value is guaranteed non-empty and is used by peer packages to verify lockstep installation.

A shared shape test asserts that all six version constants are non-empty strings and that every peer constant equals CURRENT_SDK_VERSION, surfacing version drift before it causes runtime confusion.

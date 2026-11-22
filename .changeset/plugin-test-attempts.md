---
"@vitest-agent/plugin": minor
---

## Features

- The reporter persists Vitest 5.1's `TestCase.attempts()` as per-attempt rows and links each error to the attempt that raised it, so which retry or repeat failed survives the run. Older Vitest versions without `attempts()` write nothing extra.

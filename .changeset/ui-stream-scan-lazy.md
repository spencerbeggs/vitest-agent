---
"@vitest-agent/ui": patch
---

## Bug Fixes

* `forEachRenderState` and `renderStateStream` pass the initial render state to `Stream.scan` as a thunk, as Effect rc.116 requires.

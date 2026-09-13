---
"@vitest-agent/sidecar-linux-arm64": patch
---

## Bug Fixes

- The SEA entry point now passes `process.cwd()`, `process.env`, and a `readFileSync` wrapper into the pure `dispatch` from `@vitest-agent/sdk/dispatch`, matching the sdk's new explicit I/O contract. The binary's CLI surface is unchanged.

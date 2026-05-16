---
"vitest-agent-plugin": minor
"vitest-agent-cli": minor
"vitest-agent-sidecar": minor
---

## Features

### New vitest-agent-sidecar package

A new package ships a Node Single Executable Application binary that handles the per-Bash-call command rewrite (`inject-env`) without paying a Node cold-start on every call. The binary is built with tsdown's SEA mode and distributed per platform through `optionalDependencies` — five sub-packages cover macOS arm64 and x64, Linux arm64 and x64, and Windows x64. It is declared as a peer dependency of `vitest-agent-plugin` alongside `vitest-agent-cli` and `vitest-agent-mcp`.

The binary handles `inject-env` only. `register-agent` continues to run through the `vitest-agent` JS CLI because it depends on a native SQLite binding that cannot be bundled into a JavaScript single-executable; it fires once per session and is off the per-turn critical path.

### Three-layer Bash hook prefilter

The Claude Code plugin's PreToolUse Bash hook no longer shells out to the sidecar on every Bash tool call. A bash regex prefilter skips it for commands that cannot invoke Vitest, and a second check skips it for main-agent invocations whose environment is already correct. Only subagent-triggered Vitest invocations reach the sidecar, where the hook prefers the native binary and falls back to the `vitest-agent` JS CLI — with byte-identical output — when no platform binary is installed.

## Performance

Removing the sidecar shell-out from roughly 98 percent of Bash tool calls drops the hook hot path from about 535 ms p95 to about 16 ms. Subagent Vitest invocations that still need the rewrite settle at about 88 ms p95 when the native binary is installed. The hook's payload parsing was also consolidated from six `jq` subprocesses to one.

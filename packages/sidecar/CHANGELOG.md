# vitest-agent-sidecar

## 2.0.0

### Features

* [`3eded55`](https://github.com/spencerbeggs/vitest-agent/commit/3eded55b105dd9909d313bb7709b59c194138a54) ### `resolveSidecarBinaryPath` — runtime binary resolver

`vitest-agent-sidecar` now exports `resolveSidecarBinaryPath(options?)` and the companion `ResolveSidecarBinaryPathOptions` type. The function returns the absolute path of the installed per-platform SEA binary, or `null` when the platform is unsupported or the optional dependency was not installed.

The resolver anchors its `require.resolve` call inside `vitest-agent-sidecar` — the package that declares the four per-platform packages as `optionalDependencies`. This is the only location from which `require.resolve` can find those packages; callers that import the function do not need to replicate the resolution logic.

```ts
import { resolveSidecarBinaryPath } from "vitest-agent-sidecar";

const bin = resolveSidecarBinaryPath();
if (bin !== null) {
  // exec bin directly — no Node cold-start, no PATH lookup
}
```

* [`e7f638a`](https://github.com/spencerbeggs/vitest-agent/commit/e7f638ad362418409399d08e75ab800454637cff) ### New vitest-agent-sidecar package

A new package ships a Node Single Executable Application binary that handles the per-Bash-call command rewrite (`inject-env`) without paying a Node cold-start on every call. The binary is built with tsdown's SEA mode and distributed per platform through `optionalDependencies` — five sub-packages cover macOS arm64 and x64, Linux arm64 and x64, and Windows x64. It is declared as a peer dependency of `vitest-agent-plugin` alongside `vitest-agent-cli` and `vitest-agent-mcp`.

The binary handles `inject-env` only. `register-agent` continues to run through the `vitest-agent` JS CLI because it depends on a native SQLite binding that cannot be bundled into a JavaScript single-executable; it fires once per session and is off the per-turn critical path.

### Performance

* [`e7f638a`](https://github.com/spencerbeggs/vitest-agent/commit/e7f638ad362418409399d08e75ab800454637cff) Removing the sidecar shell-out from roughly 98 percent of Bash tool calls drops the hook hot path from about 535 ms p95 to about 16 ms. Subagent Vitest invocations that still need the rewrite settle at about 88 ms p95 when the native binary is installed. The hook's payload parsing was also consolidated from six `jq` subprocesses to one.

### Removed re-exports from `vitest-agent-cli`

The prior `dispatch` and `injectEnv` re-exports (which forwarded to `vitest-agent-cli`) are gone. The package's runtime dependency on `vitest-agent-cli` is removed. `vitest-agent-sidecar` now has zero runtime workspace dependencies.

### Three-layer Bash hook prefilter

The Claude Code plugin's PreToolUse Bash hook no longer shells out to the sidecar on every Bash tool call. A bash regex prefilter skips it for commands that cannot invoke Vitest, and a second check skips it for main-agent invocations whose environment is already correct. Only subagent-triggered Vitest invocations reach the sidecar, where the hook prefers the native binary and falls back to the `vitest-agent` JS CLI — with byte-identical output — when no platform binary is installed.

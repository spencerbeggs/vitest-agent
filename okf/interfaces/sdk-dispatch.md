---
type: Interface
title: "@vitest-agent/sdk/dispatch"
description: The pure, process-free argv dispatcher the sidecar SEA binaries and the CLI's inject-env fallback both call.
kind: api
resource: ../../packages/sdk/src/sidecar-dispatch.ts
tags:
  - architecture
  - performance
  - bundle
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
sources:
  - id: sidecar-dispatch
    resource: ../../packages/sdk/src/sidecar-dispatch.ts
  - id: internal-inject-env
    resource: ../../packages/sdk/src/internal-inject-env.ts
  - id: exit-code-for-tag
    resource: ../../packages/sdk/src/exit-code-for-tag.ts
  - id: sidecar-bin-reference
    resource: ../../packages/sidecar-darwin-arm64/src/bin.ts
  - id: sdk-package-json
    resource: ../../packages/sdk/package.json
integrity:
  generated:
    body: 8d1b2b881804e0bb
---

# Interface: `@vitest-agent/sdk/dispatch`

## What stays stable

`@vitest-agent/sdk` exposes a dedicated subpath, `./dispatch`
(`src/dispatch.ts`), separate from the package's main barrel, re-exporting
`dispatch` / `DispatchIo` / `DispatchResult`
(`src/sidecar-dispatch.ts`), `injectEnv` / `InjectEnvInput`
(`src/internal-inject-env.ts`), and `exitCodeForTag`
(`src/exit-code-for-tag.ts`).[^sdk-package-json] A consumer imports from
this subpath specifically to get a minimal reachable module graph — no
Effect runtime, no data layer, no schemas — rather than the full core.

## The `dispatch(argv, io)` signature

```ts
dispatch(argv: readonly string[], io: DispatchIo): Promise<DispatchResult>
```

`argv` is the post-binary argv slice (`process.argv.slice(2)` in a real
caller). `io` supplies every process-level fact the core needs, so
`dispatch` itself never reads `process` or touches the filesystem
directly:[^sidecar-dispatch]

```ts
interface DispatchIo {
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly readFile: (path: string) => string;
}
```

- `cwd` — the default working directory used when the caller does not
  pass `--cwd` on the command line; a `--cwd` flag overrides it per call.
- `env` — the environment map (`process.env` in every real caller).
- `readFile` — a synchronous file reader. It is expected to throw on a
  miss; `dispatch` and `injectEnv` catch that throw rather than requiring
  the reader to return an optional value. The one consumer today is the
  `package.json#scripts` one-hop lookup `injectEnv` performs to detect a
  Vitest invocation behind an npm script.

`dispatch` never throws. Every failure — an unknown subcommand, a missing
required flag, an error raised inside `injectEnv` — is folded into the
returned `DispatchResult` rather than rejecting the promise or throwing
synchronously.[^sidecar-dispatch]

## The result shape and exit-code mapping

```ts
interface DispatchResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}
```

A caller writes `stdout`/`stderr` to the real streams and sets the
process exit code from `code`; `dispatch` performs no I/O itself. On
success, `code` is `0` and `stdout` carries the command's output (for
example, the rewritten Bash command from `inject-env`, newline-terminated).
On failure, `stderr` carries a `<code> <Tag>: <message>` line and `code`
comes from `exitCodeForTag`, which maps a tagged error's `_tag` to the
sidecar's agent-agnostic exit-code taxonomy — `RegistrationConflictError`
→ 1, `SidecarTimeoutError` → 2, `DataStoreError` → 3,
`ProjectIdentityNotResolvableError` → 4, and any unrecognized tag
(including the literal `"Defect"` `dispatch` assigns to malformed input)
→ 5.[^exit-code-for-tag]

## The promise that it never touches `process`

Neither `dispatch` nor `injectEnv` reads `process`, `node:fs`, or any
other Node built-in — every ambient fact arrives through `io`. The four
per-platform `@vitest-agent/sidecar-<platform>` SEA binaries and the
CLI's JS `agent inject-env` fallback are the only places `process` is
read on this path: each passes `{ cwd: process.cwd(), env: process.env,
readFile: (path) => readFileSync(path, "utf-8") }` into `dispatch`, then
writes the returned `stdout`/`stderr` and sets `process.exitCode` from
`result.code`.[^sidecar-bin-reference] This is what lets the same argv
dispatcher run identically inside a tree-shaken SEA bundle and inside the
full Node CLI process — a consumer authoring a new sidecar-like runner
supplies its own `io` and gets byte-identical behavior without
depending on Node's process globals at the call site.

[^sidecar-dispatch]: `../../packages/sdk/src/sidecar-dispatch.ts`
[^exit-code-for-tag]: `../../packages/sdk/src/exit-code-for-tag.ts`
[^sidecar-bin-reference]: `../../packages/sidecar-darwin-arm64/src/bin.ts`
[^sdk-package-json]: `../../packages/sdk/package.json`

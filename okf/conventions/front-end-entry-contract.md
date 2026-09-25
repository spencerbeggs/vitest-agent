---
type: Convention
title: Front-end entry contract — bin.ts / main.ts / index.ts / version.ts
description: "Every front end (cli, mcp) splits its entry surface into a shebang bin shim, a process-owning main, a side-effect-free index barrel, and an isolated version.ts holding the __PACKAGE_VERSION__ token."
tags: [architecture, dx]
status: stable
stale_after: 2027-03-13T00:00:00Z
sources:
  - id: cli-bin
    resource: ../../packages/cli/src/bin.ts
  - id: cli-main
    resource: ../../packages/cli/src/main.ts
  - id: cli-index
    resource: ../../packages/cli/src/index.ts
  - id: cli-version
    resource: ../../packages/cli/src/version.ts
  - id: cli-boundaries-test
    resource: ../../packages/cli/__test__/boundaries.test.ts
  - id: mcp-bin
    resource: ../../packages/mcp/src/bin.ts
  - id: mcp-main
    resource: ../../packages/mcp/src/main.ts
  - id: mcp-index
    resource: ../../packages/mcp/src/index.ts
  - id: mcp-version
    resource: ../../packages/mcp/src/version.ts
  - id: mcp-boundaries-test
    resource: ../../packages/mcp/__test__/boundaries.test.ts
  - id: plugin-bin-cli
    resource: ../../packages/plugin/src/bin/vitest-agent.ts
  - id: plugin-bin-mcp
    resource: ../../packages/plugin/src/bin/vitest-agent-mcp.ts
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 5fb37d91094363f5dfb477128efdd9d39ea19e80b24011b6ba5b9c04efcd31c7
---

# Front-end entry contract — bin.ts / main.ts / index.ts / version.ts

`@vitest-agent/cli` and `@vitest-agent/mcp` — the two "front end" packages
that own a Node process — each split their entry surface into four files
with fixed, non-negotiable responsibilities. The split exists so that a
library consumer's import graph (through `index.ts`) can never pull in
process ownership, and so the carrier package
(`@vitest-agent/plugin`) can ship the identical bin behavior without
duplicating any process-owning logic.

## `bin.ts` is a shebang shim, nothing else

Both `packages/cli/src/bin.ts` and `packages/mcp/src/bin.ts` are four
lines: a `#!/usr/bin/env node` shebang, an import of `main` from
`./main.js`, and a bare call to it[^cli-bin][^mcp-bin]. `bin.ts` carries
no logic, no argument parsing, and no error handling of its own — every
one of those responsibilities belongs to `main.ts`.

## `main.ts` owns the process and is exported at `./main`

`main.ts` is the assembled program: it resolves the data path, wires the
engine's platform layers, registers crash guards where relevant, and runs
under `NodeRuntime.runMain` — the CLI through `@effected/cli`'s
`CliRuntime.main`, the MCP server through `@effected/mcp`'s
`McpStdio.launch`[^cli-main][^mcp-main]. Each `main` takes an optional
`{ distribution }`: the package whose bin launched it, provided as
`@effected/engine`'s `CurrentDistribution`. A direct install passes
nothing. It is published as the
package's `./main` subpath specifically so a consumer other than the
shebang shim — namely the carrier — can invoke the identical assembled
program. `packages/plugin/src/bin/vitest-agent.ts` and
`vitest-agent-mcp.ts` are the two call sites that do exactly that: each
is a shim of a few lines importing `main` from `@vitest-agent/cli/main` or
`@vitest-agent/mcp/main` and invoking it with
`{ distribution: { name: "@vitest-agent/plugin", version: CURRENT_PLUGIN_VERSION } }`,
the version read from the plugin's own `src/version.ts`[^plugin-bin-cli][^plugin-bin-mcp].
The CLI's `--version` and the MCP `ping` tool surface that identity.
This is why the carrier does not need its own copy of process-ownership
logic — pnpm links only a direct dependency's declared bins, so the
carrier's `bin.vitest-agent` / `bin.vitest-agent-mcp` fields point at
these shims, which do nothing but forward into the front end's `main.ts`.

`main.ts` is never re-exported from `index.ts`. A library consumer that
only wants programmatic access to a front end's supporting pieces must
never have the process-owning module pulled into its import graph as a
side effect of importing the barrel.

## `index.ts` is a side-effect-free barrel

`packages/cli/src/index.ts` and `packages/mcp/src/index.ts` re-export
only programmatic surface — for the CLI, just
`CURRENT_CLI_VERSION`[^cli-index]; for the MCP server, the supporting
pieces (`ServerLayer`, `SERVER_INSTRUCTIONS`, `McpSession`, `Kit`,
`ToolsLayer`, `ToolRefusal`, and so on) that a custom integration might want without spawning the
bin[^mcp-index]. Neither barrel imports `./main.js`.

## `CURRENT_<PKG>_VERSION` lives in `version.ts`, and only there

Each front end's `version.ts` exports a single constant —
`CURRENT_CLI_VERSION` or `CURRENT_MCP_VERSION` — read from
`process.env.__PACKAGE_VERSION__`, a token the build substitutes at
build time from the package's own `package.json#version`, falling back
to `"0.0.0"` when unset[^cli-version][^mcp-version]. This is the single
process-env read for the package's own version, and it is also the
single legal appearance of that literal token: each package's
`boundaries.test.ts` asserts that no file under `src/` other than
`version.ts` contains the string
`process.env.__PACKAGE_VERSION__`[^cli-boundaries-test][^mcp-boundaries-test].
`main.ts` consumes the constant (to back `Command.run`'s `version`
option on the CLI, or the advertised `serverInfo.version` on the MCP
server) rather than reading the env var a second time.

## The same boundary test enforces the whole contract

Each front end's `boundaries.test.ts` allowlists exactly
`bin.ts`, `main.ts`, `version.ts`, plus one package-specific extra file
that legitimately touches ambient input (the CLI's `commands/**`, which
read `process.env` / `process.cwd()` to thread input into the engine's
pure programs; the MCP server's `tools/run-tests.ts`, which mutates
`process.env.VITEST_AGENT_*` so the in-process Vitest reporter
attributes a run) — every other file under `src/` must be free of
`process` references entirely[^cli-boundaries-test][^mcp-boundaries-test].
A new file that reads `process` outside this allowlist, or a version
token that leaks outside `version.ts`, fails this test rather than
silently drifting the contract.

See [Invariant: Package boundaries](../invariants/package-boundaries.md)
for the general boundary-test mechanism this contract rides on, and
[Glossary: Carrier](../glossary/carrier.md) for the plugin's bin-declaring
role. [Decision 70](../decisions/70-carrier-pattern-and-ranked-layering.md)
records why the carrier ships thin shims instead of any hoisting
mechanism.

[^cli-bin]: ../../packages/cli/src/bin.ts
[^cli-main]: ../../packages/cli/src/main.ts
[^cli-index]: ../../packages/cli/src/index.ts
[^cli-version]: ../../packages/cli/src/version.ts
[^cli-boundaries-test]: ../../packages/cli/__test__/boundaries.test.ts
[^mcp-bin]: ../../packages/mcp/src/bin.ts
[^mcp-main]: ../../packages/mcp/src/main.ts
[^mcp-index]: ../../packages/mcp/src/index.ts
[^mcp-version]: ../../packages/mcp/src/version.ts
[^mcp-boundaries-test]: ../../packages/mcp/__test__/boundaries.test.ts
[^plugin-bin-cli]: ../../packages/plugin/src/bin/vitest-agent.ts
[^plugin-bin-mcp]: ../../packages/plugin/src/bin/vitest-agent-mcp.ts

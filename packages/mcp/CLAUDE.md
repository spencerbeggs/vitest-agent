# @vitest-agent/mcp

The Model Context Protocol server (`vitest-agent-mcp` bin) that serves the
action-keyed tool surface to LLM agents over stdio. Effect's native
`McpServer` (`effect/ai`) through the `@effected/mcp` kit: 30 tools (23
`Tool.make`, seven union-parameter `Tool.dynamic`) in one `Toolkit`,
registered strict-by-default with `McpToolkit.layer`, plus six framing-only
prompts, served as one Effect `Layer` over `McpStdio.layer`. No MCP SDK, no
tRPC, no zod. Rank 4: depends on `@vitest-agent/engine` and
`@vitest-agent/sdk`, never on `@vitest-agent/cli`. The plugin carrier
re-ships the bin as a shim over `@vitest-agent/mcp/main`.

This file orients; the design knowledge lives in the bundle. Load
[`okf/modules/mcp.md`](../../okf/modules/mcp.md) before changing anything
below `src/`.

## Layout

```text
src/
  bin.ts            -- `void main()`, nothing else
  main.ts           -- owns the process; published at `./main`; McpGuard.run
                       registers crash guards FIRST, then load() imports the
                       server graph dynamically
  index.ts          -- side-effect-free barrel; never imports main.ts
  server.ts         -- ServerLayer({ version }) + SERVER_INSTRUCTIONS
  toolkit.ts        -- Kit (the 30 tools) + toolHandlers + ToolsLayer
  session.ts        -- McpSession: { cwd, currentSessionId, sessionContext }
  replay.ts         -- ToolReplay over mcp_idempotent_responses: per-tool replay
                       keys + the KeyValueStore adapter (`replayed`)
  annotations.ts    -- RenderText: deprecated no-op, removed at the next major
  tools/            -- one file per tool (schemas, Tool value, handle<Name>);
                       _tdd-error-envelope.ts and _project-groups.ts are private
  prompts/          -- layer.ts (PromptsLayer) + one pure factory per prompt
  utils/            -- safe-format-fatal-error.ts, replay-marker.ts
  version.ts        -- CURRENT_MCP_VERSION (build-time literal)
```

The entry contract (`bin.ts` / `main.ts` / `index.ts` / `version.ts`) is
[Convention: front-end entry
contract](../../okf/conventions/front-end-entry-contract.md).

## Must-know rules

- **`main.ts` carries no static import of the server graph.** The one
  static import is `@effected/mcp/guard`; everything else is a dynamic
  `import()` inside `McpGuard.run`'s `load`, so a throw during module
  evaluation is reported on stderr instead of crashing silently. Adding a
  static import defeats the design. Never remove or loosen the guard, or
  collapse it into a bare `main().catch()`.
- **Every served input is strict at every object level.** Register through
  `McpToolkit.layer`, never `McpServer.toolkit`; a union `parameters`
  schema is `McpToolkit.unionTool` + `McpToolkit.unionHandler`; a union
  success schema is wrapped in `ToolOutputSchema.objectRooted`.
- **stdout is the JSON-RPC wire.** Every log line goes to stderr. Never
  `console.log` in a tool; the harness dies on any non-JSON-RPC stdout
  line.
- **A failure the agent must act on is never a defect.** Put it in the
  success shape (`ok: false` / `kind: "error"`) or a declared
  `ToolRefusal`; a defect reaches the agent only as scrubbed
  internal-error text.
- **Agents read `structuredContent` only.** An undeclared result key is
  stripped by the encoder, so anything the agent must read (including the
  `_idempotentReplay` marker) is declared on the success schema.
- **`run_tests` is the one tool allowed to touch `process`** (scoped env
  writes and a `chdir` for the run via `ProcessScope`, inside a one-permit
  `Exclusive` lane; nested stdio diverted through `StdioCapture`, which
  `main.ts` installs). Resolve
  `vitest/node` from the run's root, never from this package. Every other
  tool reads ambient input through `McpSession`.
- **Keep the `VITEST_AGENT_REPORTER_PROJECT_DIR` fallback** in `projectDir`
  resolution: the plugin loader sets it because Claude Code does not
  reliably propagate `CLAUDE_PROJECT_DIR` to MCP subprocesses.
- **Prompts are framing-only** and must not call `DataReader` / `DataStore`.
- **Enumerate projects, never default to `"default"`**: `inventory` and
  `test` list every project from `getRunsByProject()` when `project` is
  unspecified. Push history narrowing (`testName` / `modulePath` / `limit`)
  into `DataReader`, not into the tool.
- **If `dbPath` resolution fails at boot the server must not start**: exit 1
  with the diagnostic on stderr so the loader can print install
  instructions.

## Adding a tool or prompt

Follow [Runbook: add an MCP tool](../../okf/runbooks/add-an-mcp-tool.md).
The short form: `tools/<name>.ts` with schemas, the `Tool.make` (or
`McpToolkit.unionTool`) value and `handle<Name>`; add both to `toolkit.ts`
(`Kit` + `toolHandlers`, a mismatch is a compile error); wrap a retry-safe
write in `withIdempotency` and register its key in `idempotency.ts`; extend
`served-schema-strict.test.ts`'s case list (and `served-enum-drift.test.ts`
for an action-keyed tool: add the variant to the exported tuple and the
`Match` branch together); update `tools/help.ts` — **`help-drift.test.ts`
pins the `help` text to the served toolkit and prompt layer, so a new tool
or prompt `help` does not mention fails until it does**; add the name to
the plugin's `plugin/hooks/lib/vitest-agent/safe-mcp-ops.txt` (omit
destructive tools so they prompt) and rebuild the plugin. A prompt is a
pure factory in `prompts/<slug>.ts` plus an `McpServer.prompt({...})` in
`prompts/layer.ts` with string-based parameters (`Schema.optionalKey` for
optional ones), and an entry in `prompts-layer.test.ts`'s expected name
list.

## Testing

`__test__/utils/harness.ts` runs the real `ServerLayer` in-process over
`@effected/mcp/testing`'s `McpHarness` (exact served schemas and wire
results); `__test__/utils/caller.ts`'s `makeCaller` invokes handlers
directly with full type narrowing. Only crash guards and process lifecycle
need the spawned bin (`*.e2e.test.ts`) — rebuild `dist/dev` first. Details:
`okf/modules/mcp.md`, *Testing surface*.

## Design references

- [`okf/modules/mcp.md`](../../okf/modules/mcp.md) — bootstrap, strict
  registration, `run_tests` root handling, tag filtering, idempotency,
  session recovery, crash resilience, the testing surface.
- [`okf/interfaces/mcp-tools.md`](../../okf/interfaces/mcp-tools.md) — the
  30 tools and six prompts from the consumer's side; what stays stable.
- [`okf/runbooks/add-an-mcp-tool.md`](../../okf/runbooks/add-an-mcp-tool.md)
- [`okf/models/sqlite-schema.md`](../../okf/models/sqlite-schema.md) — the
  idempotency registry and the TDD goal/behavior tables.
- [`okf/decisions/35-framing-only-mcp-prompts.md`](../../okf/decisions/35-framing-only-mcp-prompts.md),
  [`okf/decisions/50-strict-mcp-tool-inputs.md`](../../okf/decisions/50-strict-mcp-tool-inputs.md),
  [`okf/decisions/51-the-mcp-server-survives-post-connect-crashes.md`](../../okf/decisions/51-the-mcp-server-survives-post-connect-crashes.md),
  [`okf/decisions/60-single-source-served-mcp-discriminants.md`](../../okf/decisions/60-single-source-served-mcp-discriminants.md),
  [`okf/decisions/71-effect-native-mcp-server.md`](../../okf/decisions/71-effect-native-mcp-server.md),
  [`okf/decisions/72-adopt-the-effected-front-end-kit.md`](../../okf/decisions/72-adopt-the-effected-front-end-kit.md),
  [`okf/decisions/d13-mcp-permits-agent-restricts.md`](../../okf/decisions/d13-mcp-permits-agent-restricts.md)
  — the why behind the rules above.
- [`okf/gotchas/stale-mcp-server-modules.md`](../../okf/gotchas/stale-mcp-server-modules.md)
  — a long-running server keeps old modules after a relink or reinstall;
  restart it with `/mcp` before debugging the tree.

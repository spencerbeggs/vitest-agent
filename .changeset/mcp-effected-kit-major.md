---
"@vitest-agent/mcp": major
---

## Breaking Changes

### Server rebuilt on the `@effected/mcp` front-end kit

The MCP server now runs on `@effected/mcp`'s `McpToolkit` and `McpStdio` transport instead of hand-rolled stdio plumbing. Served tool input schemas are unchanged, so well-formed requests are unaffected, but several failure and remediation shapes changed:

* The `UnexpectedToolError` envelope is gone. An undeclared tool failure now surfaces the kit's scrubbed message, `Tool execution failed due to an internal server error.`, instead of the previous error shape.
* `tdd_goal`, `tdd_behavior`, and `tdd_phase_transition_request` remediation objects rename `humanHint` to `hint`, matching the engine's `Remediation` shape. `suggestedTool` and `suggestedArgs` are now optional on that schema.
* The `registerStrictToolkit` export is removed.

Agents and clients that pattern-matched on the old `UnexpectedToolError` shape or on `humanHint` need to update; everything else keeps working unmodified.

## Features

* Malformed stdin lines are now answered with proper JSON-RPC `-32700` (parse error) or `-32600` (invalid request) responses.
* Every served tool now carries an object-rooted `outputSchema` (#489).
* Agent-actionable failures — unknown ids passed to `hypothesis` record/validate, `tdd_task` start with an unknown `chatId`/`sessionId`, and similar — are declared refusals that name the fix directly in the result, rather than generic errors.
* `ping` now reports a `distribution` field.
* `run_tests` responds to unsafe/invalid arguments with a `{ kind: "error" }` result instead of throwing.
* Unknown-key validation messages now end with a period.
* Server instructions now tell agents to read `structuredContent` only.
* `main(options?)` accepts an options object and threads a `distribution` value through server startup.
* Invalid params to the seven action-keyed tools answer JSON-RPC `-32602` on the 2025-06-18 protocol, exactly like every other tool, via `@effected/mcp`'s `McpToolkit.unionTool`.
* Crash guards run through `@effected/mcp/guard`: an uncaught exception before the stdio transport connects exits 1 without serving, and after connect it is logged and the server keeps serving.

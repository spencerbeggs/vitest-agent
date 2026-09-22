---
"@vitest-agent/mcp": minor
---

## Features

### Prompt titles

The six framing prompts now serve a human-readable `title` in `prompts/list`, so clients with a prompt picker show "Triage Recent Failures", "Diagnose a Flaky Test", "Find What Broke a Test", "Explain a Failure Class", "Resume TDD Work" and "Generate a Session Wrapup" instead of the snake_case names. The `name` stays the stable key.

### JSON text channel

Every successful tool result now sends the same object in both places: the typed result in `structuredContent`, and that result serialized as JSON in `content[0].text`. The per-tool markdown renderings are gone. Claude Code forwards only `structuredContent` to the model, so they were never read there. Clients that read only `content` (for example Cursor or MCP Apps hosts) now see JSON, which is what the MCP spec recommends. Result fields that carry markdown as data, such as `triage_brief.markdown`, `wrapup_prompt.markdown` and `help.helpText`, are unchanged.

`RenderText` is deprecated. It is still exported so existing `.annotate(RenderText, ...)` calls compile, but the server no longer reads it. It will be removed in the next major.

## Refactoring

* `registerStrictToolkit` now treats every tool as `Tool.Strict`. Tool inputs are decoded with Effect's native excess-property rejection, and the served input schemas come from Effect's own strict JSON Schema document. The rejection message is unchanged: it still names every unrecognized key and lists the accepted params.

## Documentation

* The `help` text no longer advertises a `format` parameter on `test_errors`, which the tool never accepted.

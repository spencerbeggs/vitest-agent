// Tool annotations specific to the vitest-agent MCP server, read by
// `registerStrictToolkit` alongside Effect's built-in `Tool.Readonly` /
// `Tool.Destructive` / `Tool.Idempotent` / `Tool.OpenWorld` keys.

import { Context } from "effect";

/**
 * Renders a tool's encoded result as the human-readable `content[0].text`
 * channel (markdown, typically). Returning `undefined` — or leaving the
 * annotation unset — falls back to `JSON.stringify(encoded)`.
 *
 * Attach with `tool.annotate(RenderText, (encoded) => ...)`; the renderer
 * receives the wire-encoded result (the same value that becomes
 * `structuredContent`), never the decoded domain value.
 *
 * @public
 */
export const RenderText = Context.Reference<((result: unknown) => string | undefined) | undefined>(
	"@vitest-agent/mcp/RenderText",
	{ defaultValue: () => undefined },
);

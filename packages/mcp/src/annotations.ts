// Tool annotations specific to the vitest-agent MCP server.

import { Context } from "effect";

/**
 * Formerly rendered a tool's encoded result as a markdown `content[0].text`
 * channel. The server no longer reads it: every successful result carries
 * the typed object in `structuredContent` and its JSON in `content[0].text`,
 * because Claude Code forwards only `structuredContent` to the model.
 * Attaching it is a no-op.
 *
 * @deprecated Nothing reads this annotation any more; remove the
 * `.annotate(RenderText, ...)` call. It will be removed in the next major.
 * @public
 */
export const RenderText = Context.Reference<((result: unknown) => string | undefined) | undefined>(
	"@vitest-agent/mcp/RenderText",
	{ defaultValue: () => undefined },
);

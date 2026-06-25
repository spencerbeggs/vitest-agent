import { Effect, Layer } from "effect";
import { ciAnnotationsFormatter } from "../formatters/ci-annotations.js";
import { GfmFormatter } from "../formatters/gfm.js";
import { JsonFormatter } from "../formatters/json.js";
import { MarkdownFormatter } from "../formatters/markdown.js";
import { SilentFormatter } from "../formatters/silent.js";
import { TerminalFormatter } from "../formatters/terminal.js";
import type { Formatter } from "../formatters/types.js";
import { OutputRenderer } from "../services/OutputRenderer.js";

const formatters = new Map<string, Formatter>([
	["terminal", TerminalFormatter],
	["markdown", MarkdownFormatter],
	["gfm", GfmFormatter],
	["json", JsonFormatter],
	["silent", SilentFormatter],
	["vitest-bypass", SilentFormatter],
	["ci-annotations", ciAnnotationsFormatter],
]);
/** @public */
export const OutputRendererLive = Layer.succeed(OutputRenderer, {
	render: (reports, format, context) =>
		Effect.sync(() => {
			const formatter = formatters.get(format);
			if (!formatter) return [];
			return formatter.render(reports, context);
		}),
});

import type { Formatter } from "@vitest-agent/sdk";
import {
	GfmFormatter,
	JsonFormatter,
	MarkdownFormatter,
	SilentFormatter,
	TerminalFormatter,
	ciAnnotationsFormatter,
} from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
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

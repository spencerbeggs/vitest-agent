import { formatConsoleMarkdown } from "../utils/format-console.js";
import type { Formatter, RenderedOutput } from "./types.js";

/**
 * Markdown formatter for surfaces that *render* markdown.
 *
 * Stdout output goes through {@link TerminalFormatter} (plain text +
 * ANSI), not this formatter — markdown syntax (e.g. heading prefixes,
 * backticks, list dashes) is visual noise in a terminal that doesn't
 * render it. This formatter remains for callers that explicitly request
 * `format: "markdown"`, e.g. when piping the rendered output into a
 * Markdown-aware sink.
 * @public
 */
export const MarkdownFormatter: Formatter = {
	format: "markdown",
	render: (reports, context) => {
		const outputs: RenderedOutput[] = [];
		for (const report of reports) {
			const md = formatConsoleMarkdown(report, {
				consoleOutput: context.detail === "minimal" ? "failures" : "full",
				coverageConsoleLimit: context.coverageConsoleLimit,
				noColor: context.noColor,
				...(context.trendSummary !== undefined ? { trendSummary: context.trendSummary } : {}),
				...(context.runCommand !== undefined ? { runCommand: context.runCommand } : {}),
				...(context.mcp !== undefined ? { mcp: context.mcp } : {}),
			});
			if (md) {
				outputs.push({
					target: "stdout",
					content: md,
					contentType: "text/markdown",
				});
			}
		}
		return outputs;
	},
};

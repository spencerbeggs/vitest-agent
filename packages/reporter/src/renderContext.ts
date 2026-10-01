/**
 * The `RenderContext` the reporter renders its kit `Doc`s through.
 *
 * @privateRemarks
 * The reporter runs inside Vitest, not inside an Effect CLI runtime, so it has
 * no `CliTheme | TerminalEnv | Audience | CliLinks` to hand `Render.context`.
 * The kit ships no pure constructor for a context (dogfood finding G0, effected
 * cc262d6e), so this builds the exported `RenderContext` shape by hand: a CI
 * audience with no colour, no hyperlinks, Unicode glyphs and no width limit.
 * Every output it serves is machine-facing text (a GitHub log block, a step
 * summary, a report file), so none of those choices depend on the terminal.
 * Replace this with the kit's pure constructor once one exists.
 *
 * @internal
 */

import type { RenderContext } from "@effected/cli";
import { Glyphs } from "@effected/cli";

/**
 * Options for {@link reporterRenderContext}.
 *
 * @internal
 */
export interface ReporterRenderContextOptions {
	/** Turns an absolute path into its display form. */
	readonly displayPath: (absolute: string) => string;
	/**
	 * Defang `::` lines and `##[` sequences so document text cannot become a
	 * workflow command. Set it for output the Actions runner reads as a log;
	 * leave it off for files (the step summary, `summary.md`).
	 */
	readonly neutralizeWorkflowCommands: boolean;
}

/**
 * A pure CI render context: no colour, no links, unbounded width.
 *
 * @internal
 */
export const reporterRenderContext = (options: ReporterRenderContextOptions): RenderContext => ({
	width: Number.POSITIVE_INFINITY,
	audience: "ci",
	color: "none",
	paint: (_token, text) => text,
	glyphs: Glyphs.unicode,
	link: (_target, label) => label,
	displayPath: options.displayPath,
	neutralizeWorkflowCommands: options.neutralizeWorkflowCommands,
});

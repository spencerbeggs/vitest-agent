/**
 * Pure formatter for the show command — given a cached AgentReport
 * and a target format, produces the rendered string.
 *
 * Lives separate from the \@effect/cli wrapper so it can be tested
 * as a plain function.
 *
 * @packageDocumentation
 */

import type { AgentReport } from "vitest-agent-sdk";
import { renderRun, synthesizeFromAgentReport } from "vitest-agent-ui";

export type ShowFormat = "agent" | "human" | "json";

export interface FormatShowOptions {
	readonly width?: number;
}

/**
 * Render a single cached AgentReport for the show command.
 *
 * - `json` returns a stable pretty-printed JSON dump of the report.
 * - `agent` returns the markdown-flavored agent renderer's output.
 * - `human` returns the Ink renderToString output (ANSI colors retained).
 */
export const formatShow = (report: AgentReport, format: ShowFormat, options: FormatShowOptions = {}): string => {
	if (format === "json") {
		return JSON.stringify(report, null, 2);
	}
	const events = synthesizeFromAgentReport(report);
	const width = options.width ?? 80;
	return renderRun(events, format, { width });
};

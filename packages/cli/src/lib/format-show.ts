/**
 * Pure formatter for the show command — given a cached AgentReport
 * and a target format, produces the rendered string.
 *
 * Lives separate from the (at)effect/cli wrapper so it can be tested
 * as a plain function. After the T6 UI rewrite the renderer entry
 * points are the dispatcher cells; this helper picks the right path
 * for each format and delegates to the UI package's per-report
 * convenience helpers.
 *
 * @packageDocumentation
 */

import type { AgentReport } from "vitest-agent-sdk";
import { renderAgentStringForReport, renderHumanStringForReport } from "vitest-agent-ui";

export type ShowFormat = "agent" | "human" | "json";

export interface FormatShowOptions {
	readonly width?: number;
}

/**
 * Render a single cached AgentReport for the show command.
 *
 * - `json` returns a stable pretty-printed JSON dump of the report.
 * - `agent` returns the dispatcher's agent-half string for the
 *   classified cell.
 * - `human` returns the Ink frame for the same cell, with ANSI
 *   escapes preserved for terminal rendering.
 */
export const formatShow = async (
	report: AgentReport,
	format: ShowFormat,
	options: FormatShowOptions = {},
): Promise<string> => {
	if (format === "json") {
		return JSON.stringify(report, null, 2);
	}
	if (format === "agent") {
		return renderAgentStringForReport(report);
	}
	return renderHumanStringForReport(report, options);
};

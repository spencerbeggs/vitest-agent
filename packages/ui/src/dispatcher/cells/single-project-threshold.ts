import type { DispatchInputs } from "vitest-agent-sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatBelowTargetTable, formatCoverageJudgmentLine, formatTotals, formatTrendLine } from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const BELOW_TARGET_LIMIT = 5;

const renderAgent = (inputs: DispatchInputs): string => {
	const sections: string[][] = [[formatTotals(inputs.state)]];
	const coverage = formatCoverageJudgmentLine(inputs.state);
	const trend = formatTrendLine(inputs.trend);
	const summaryLines: string[] = [];
	if (coverage !== null) summaryLines.push(coverage);
	if (trend !== null) summaryLines.push(trend);
	if (summaryLines.length > 0) {
		sections.push(summaryLines);
	}
	const below = formatBelowTargetTable(inputs.belowTarget, BELOW_TARGET_LIMIT);
	if (below.length > 0) {
		sections.push([...below]);
	}
	return `${sections.map((section) => section.join("\n")).join("\n\n")}\n${buildFooter(inputs)}`;
};

export const renderSingleProjectThreshold: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

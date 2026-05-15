import type { DispatchInputs } from "vitest-agent-sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import {
	formatBelowTargetTable,
	formatCoverageJudgmentLine,
	formatProjectsTable,
	formatTrendLine,
	formatWorkspaceTotal,
} from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const BELOW_TARGET_LIMIT = 10;

const renderAgent = (inputs: DispatchInputs): string => {
	const sections: string[][] = [];
	const projects = formatProjectsTable(inputs.projects);
	if (projects.length > 0) sections.push([...projects]);
	const summaryLines: string[] = [];
	const coverage = formatCoverageJudgmentLine(inputs.state);
	if (coverage !== null) summaryLines.push(coverage);
	const trend = formatTrendLine(inputs.trend);
	if (trend !== null) summaryLines.push(trend);
	if (summaryLines.length > 0) sections.push(summaryLines);
	const below = formatBelowTargetTable(inputs.belowTarget, BELOW_TARGET_LIMIT, inputs.runCommand);
	if (below.length > 0) sections.push([...below]);
	if (inputs.projects.length > 0) {
		sections.push([formatWorkspaceTotal(inputs.projects)]);
	}
	return `${sections.map((section) => section.join("\n")).join("\n\n")}\n${buildFooter(inputs)}`;
};

export const renderWorkspaceThreshold: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

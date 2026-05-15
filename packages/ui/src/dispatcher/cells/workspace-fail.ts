import type { DispatchInputs } from "vitest-agent-sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatFailure, formatProjectsTable, formatTrendLine, formatWorkspaceTotal } from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const DEFAULT_WIDTH = 80;

const renderAgent = (inputs: DispatchInputs): string => {
	const sections: string[][] = [];
	const projects = formatProjectsTable(inputs.projects);
	if (projects.length > 0) sections.push([...projects]);
	if (inputs.state.failures.length > 0) {
		const failureLines = ["Failures:"];
		for (const failure of inputs.state.failures) {
			failureLines.push(...formatFailure(failure, DEFAULT_WIDTH));
		}
		sections.push(failureLines);
	}
	const trend = formatTrendLine(inputs.trend);
	if (trend !== null) sections.push([trend]);
	if (inputs.projects.length > 0) {
		sections.push([formatWorkspaceTotal(inputs.projects)]);
	}
	return `${sections.map((section) => section.join("\n")).join("\n\n")}\n${buildFooter(inputs)}`;
};

export const renderWorkspaceFail: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

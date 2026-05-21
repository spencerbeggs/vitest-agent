import type { DispatchInputs } from "vitest-agent-sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatCoverageJudgmentLine, formatDisplayDuration, soleModulePath } from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const renderAgent = (inputs: DispatchInputs): string => {
	const modulePath = soleModulePath(inputs.state);
	if (modulePath === undefined) return "";
	const { passCount, durationMs } = inputs.state.totals;
	const noun = passCount === 1 ? "test" : "tests";
	const lines = [`${modulePath}: ${passCount} ${noun} passed (${formatDisplayDuration(durationMs)})`];
	const coverage = formatCoverageJudgmentLine(inputs.state);
	if (coverage !== null) {
		lines.push(coverage);
	}
	return `${lines.join("\n")}\n${buildFooter(inputs)}`;
};

export const renderSingleFileThreshold: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

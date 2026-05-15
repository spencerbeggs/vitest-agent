import type { DispatchInputs } from "vitest-agent-sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatDuration, formatTestName, soleTest } from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const renderAgent = (inputs: DispatchInputs): string => {
	const test = soleTest(inputs.state);
	if (test === undefined) return "";
	const duration = test.durationMs ?? 0;
	return `✓ ${formatTestName(test)} (${formatDuration(duration)})\n${buildFooter(inputs)}`;
};

export const renderSingleTestPass: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

import type { DispatchInputs } from "vitest-agent-sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatTotals } from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const renderAgent = (inputs: DispatchInputs): string => {
	const modules = inputs.state.moduleOrder.length;
	const noun = modules === 1 ? "module" : "modules";
	const lines = [formatTotals(inputs.state), `${modules} ${noun} all-passed.`];
	return `${lines.join("\n\n")}\n${buildFooter(inputs)}`;
};

export const renderSingleProjectPass: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

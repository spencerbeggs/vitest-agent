import { Fmt } from "@effected/cli";
import type { DispatchInputs } from "@vitest-agent/sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatDisplayDuration, soleModulePath } from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const renderAgent = (inputs: DispatchInputs): string => {
	const modulePath = soleModulePath(inputs.state);
	if (modulePath === undefined) return "";
	const { passCount, durationMs } = inputs.state.totals;
	return `${modulePath}: ${Fmt.plural(passCount, "test")} passed (${formatDisplayDuration(durationMs)})\n${buildFooter(inputs)}`;
};

export const renderSingleFilePass: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

import { Fmt } from "@effected/cli";
import type { DispatchInputs } from "@vitest-agent/sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatCoverageSummaryLines, formatDisplayDuration, soleModulePath } from "../helpers.js";

const renderAgent = (inputs: DispatchInputs): string => {
	const modulePath = soleModulePath(inputs.state);
	if (modulePath === undefined) return "";
	const { passCount, durationMs } = inputs.state.totals;
	const lines = [`${modulePath}: ${Fmt.plural(passCount, "test")} passed (${formatDisplayDuration(durationMs)})`];
	lines.push(...formatCoverageSummaryLines(inputs.state));
	return `${lines.join("\n")}\n${buildFooter(inputs)}`;
};

export const renderSingleFileThreshold: Cell = {
	agent: renderAgent,
};

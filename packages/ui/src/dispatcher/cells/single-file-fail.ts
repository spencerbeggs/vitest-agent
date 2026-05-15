import type { DispatchInputs } from "vitest-agent-sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatDuration, formatFailure, soleModulePath } from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const DEFAULT_WIDTH = 80;

const renderAgent = (inputs: DispatchInputs): string => {
	const modulePath = soleModulePath(inputs.state);
	if (modulePath === undefined) return "";
	const { passCount, failCount, skipCount, durationMs } = inputs.state.totals;
	const total = passCount + failCount + skipCount;
	const parts = [`${passCount}/${total} passed`];
	if (failCount > 0) parts.push(`${failCount} failed`);
	if (skipCount > 0) parts.push(`${skipCount} skipped`);
	const header = `${modulePath}: ${parts.join(", ")} (${formatDuration(durationMs)})`;
	const sections: string[] = [header];
	if (inputs.state.failures.length > 0) {
		sections.push("Failures:");
		for (const failure of inputs.state.failures) {
			sections.push(...formatFailure(failure, DEFAULT_WIDTH));
		}
	}
	return `${sections.join("\n")}\n${buildFooter(inputs)}`;
};

export const renderSingleFileFail: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

import type { DispatchInputs } from "@vitest-agent/sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatFailure, formatTotals } from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const DEFAULT_WIDTH = 80;

const renderAgent = (inputs: DispatchInputs): string => {
	const sections: string[][] = [[formatTotals(inputs.state)]];
	if (inputs.state.failures.length > 0) {
		const failureLines = ["Failures:"];
		for (const failure of inputs.state.failures) {
			failureLines.push(...formatFailure(failure, DEFAULT_WIDTH));
		}
		sections.push(failureLines);
	}
	const moduleLines = ["Modules:"];
	for (const path of inputs.state.moduleOrder) {
		const m = inputs.state.modules[path];
		if (!m) continue;
		const parts: string[] = [];
		if (m.passCount > 0) parts.push(`${m.passCount} passed`);
		if (m.failCount > 0) parts.push(`${m.failCount} failed`);
		if (m.skipCount > 0) parts.push(`${m.skipCount} skipped`);
		const summary = parts.length > 0 ? parts.join(", ") : `status=${m.status}`;
		moduleLines.push(`- ${m.modulePath}: ${summary}`);
	}
	if (moduleLines.length > 1) {
		sections.push(moduleLines);
	}
	return `${sections.map((section) => section.join("\n")).join("\n\n")}\n${buildFooter(inputs)}`;
};

export const renderSingleProjectFail: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

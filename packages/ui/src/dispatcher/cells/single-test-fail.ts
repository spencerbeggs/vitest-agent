import type { DispatchInputs } from "@vitest-agent/sdk";
import { statusGlyph } from "../../theme.js";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatDisplayDuration, formatFailure, formatTestName, soleTest } from "../helpers.js";

const DEFAULT_WIDTH = 80;

const renderAgent = (inputs: DispatchInputs): string => {
	const test = soleTest(inputs.state);
	if (test === undefined) return "";
	const duration = test.durationMs ?? 0;
	const header = `${statusGlyph("failure")} ${formatTestName(test)} (${formatDisplayDuration(duration)})`;
	const failure = inputs.state.failures[0];
	const base =
		failure === undefined ? `${header}\n` : `${header}\n${formatFailure(failure, DEFAULT_WIDTH).join("\n")}\n`;
	return `${base}${buildFooter(inputs)}`;
};

export const renderSingleTestFail: Cell = {
	agent: renderAgent,
};

import type { DispatchInputs } from "@vitest-agent/sdk";
import type { Cell } from "../cell-types.js";
import { buildFooter } from "../footer.js";
import { formatTotals } from "../helpers.js";
import { renderAgentStringAsInk } from "../ink-helpers.js";

const renderAgent = (inputs: DispatchInputs): string => {
	const { passCount, failCount, skipCount, timeoutCount } = inputs.state.totals;
	// Include timeoutCount: a run whose only test timed out has
	// pass=fail=skip=0 but a real collected test, and must not print
	// "0 tests collected" for it.
	const total = passCount + failCount + skipCount + timeoutCount;
	if (total === 0) {
		const lines = [
			formatTotals(inputs.state),
			"0 tests collected. A zero-test run usually means a wrong working directory, a filter that matched nothing, or a load-time error — verify before trusting it.",
		];
		return `${lines.join("\n\n")}\n${buildFooter(inputs)}`;
	}
	const collected = inputs.state.collectedModules ?? inputs.state.moduleOrder.length;
	// A nonzero total with no knowable module count (no `collectedModules` on
	// a replayed report, no tracked `moduleOrder` entries either) must not
	// fall through to "0 modules all-passed" — the exact #204 symptom this
	// task fixes. Drop the module-count sentence entirely and stay with the
	// totals line, mirroring render-agent.ts's `formatModulesSection`, which
	// returns `null` (omits the section) in the same state.
	const lines =
		collected === 0
			? [formatTotals(inputs.state)]
			: [formatTotals(inputs.state), `${collected} ${collected === 1 ? "module" : "modules"} all-passed.`];
	return `${lines.join("\n\n")}\n${buildFooter(inputs)}`;
};

export const renderSingleProjectPass: Cell = {
	agent: renderAgent,
	ink: (inputs) => renderAgentStringAsInk(renderAgent(inputs)),
};

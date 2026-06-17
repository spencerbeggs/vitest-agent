/**
 * L1 MCP tool-pointer footer.
 *
 * Each dispatcher cell appends one (sometimes two) trailing lines that
 * point the agent at the most relevant `vitest-agent-mcp` tools for
 * its next action. The footer is a pure function of
 * {@link DispatchInputs}; cells call it directly.
 *
 * Mapping table (UI rewrite spec §3.6):
 *
 * | Cell outcome class                     | Footer pointer |
 * | -------------------------------------- | -------------- |
 * | all-pass plus coverage gap             | `Use file_coverage to find uncovered functions.` |
 * | failures with new or persistent class  | `Use test_errors for failure detail; failure_signature_get to check known patterns.` |
 * | failures with flaky classification     | `Use failure_signature_get to confirm the flakiness signature.` |
 * | threshold violation only               | `Use test_coverage for the workspace coverage breakdown.` |
 *
 * Inline backtick formatting is included verbatim in the agent output —
 * agents read the literal characters as cues, not markdown.
 *
 * @packageDocumentation
 */

import type { DispatchInputs, FailureRecord, RenderState, TestClassification } from "@vitest-agent/sdk";

const FOOTER_COVERAGE_GAP = "Use `file_coverage` to find uncovered functions.";
const FOOTER_FAILURE_PERSISTENT =
	"Use `test_errors` for failure detail; `failure_signature_get` to check known patterns.";
const FOOTER_FAILURE_FLAKY = "Use `failure_signature_get` to confirm the flakiness signature.";
const FOOTER_THRESHOLD = "Use `test_coverage` for the workspace coverage breakdown.";

/**
 * Pick the dominant classification from a state's failure list.
 *
 * Priority order (most actionable first): `new-failure`, `persistent`,
 * `flaky`, `recovered`, `stable`. Returns `null` when the failure list
 * is empty or every failure is unclassified.
 */
export const dominantClassification = (state: RenderState): TestClassification | null => {
	if (state.failures.length === 0) return null;
	const priority: ReadonlyArray<TestClassification> = ["new-failure", "persistent", "flaky", "recovered", "stable"];
	const present = new Set<TestClassification>();
	for (const f of state.failures as ReadonlyArray<FailureRecord>) {
		if (f.classification !== null) present.add(f.classification);
	}
	for (const cls of priority) {
		if (present.has(cls)) return cls;
	}
	return null;
};

/**
 * Compose the trailing footer lines for a dispatcher cell. Returns an
 * empty string when no pointer applies. The footer starts with a
 * leading newline so cells can append it directly without crafting
 * their own separator.
 */
export const buildFooter = (inputs: DispatchInputs): string => {
	const lines: string[] = [];
	if (inputs.outcome === "all-pass" && inputs.belowTarget.length > 0) {
		lines.push(FOOTER_COVERAGE_GAP);
	}
	if (inputs.outcome === "some-fail") {
		const cls = dominantClassification(inputs.state);
		if (cls === "new-failure" || cls === "persistent") {
			lines.push(FOOTER_FAILURE_PERSISTENT);
		} else if (cls === "flaky") {
			lines.push(FOOTER_FAILURE_FLAKY);
		}
	}
	if (inputs.outcome === "threshold-violation") {
		lines.push(FOOTER_THRESHOLD);
	}
	if (lines.length === 0) return "";
	return `\n${lines.join("\n")}\n`;
};

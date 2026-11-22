/**
 * Trace-timeline step lines shared by the agent (`formatFailure`) and human
 * (Ink `FailureSection`) failure renderers. Pure strings, no React or Ink, so
 * it lives at the ui root. Mirrors the columns of Vitest's own trace renderer
 * (step, locator, start, duration, location) without its table padding or
 * colour, so the lines stay token-efficient for agents.
 */

import type { TraceStep } from "@vitest-agent/sdk";

const ms = (value: number): string => `${Math.round(value)}ms`;

/**
 * One line per step, indented two spaces per nesting level, e.g.
 * `click [button]  +12ms  3ms  src/a.test.ts:4:7  FAIL`.
 *
 * @param steps - the failed attempt's steps, oldest first
 * @returns the lines with a leading `Trace:` header, or `[]` when there are no steps
 * @internal
 */
export const formatTraceStepLines = (steps: ReadonlyArray<TraceStep> | undefined): ReadonlyArray<string> => {
	if (steps === undefined || steps.length === 0) return [];
	const lines = steps.map((step) => {
		const parts = [
			`${"  ".repeat(Math.max(0, step.depth))}${step.name}${step.locator !== undefined ? ` [${step.locator}]` : ""}`,
			`+${ms(step.startTime)}`,
		];
		if (step.duration !== undefined) parts.push(ms(step.duration));
		if (step.location !== undefined) parts.push(`${step.location.file}:${step.location.line}:${step.location.column}`);
		if (step.status === "fail") parts.push("FAIL");
		return `  ${parts.join("  ")}`;
	});
	return ["Trace:", ...lines];
};

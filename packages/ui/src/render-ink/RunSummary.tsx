/**
 * Top-of-frame run summary: one line carrying pass/fail/skip counts and total duration.
 *
 * @packageDocumentation
 */

import { Box, Text } from "ink";
import type { FC } from "react";
import * as React from "react";
import type { RenderState, RenderTotals } from "vitest-agent-sdk";

export interface RunSummaryProps {
	readonly phase: RenderState["phase"];
	readonly totals: RenderTotals;
}

const phaseLabel = (phase: RenderState["phase"]): string => {
	if (phase === "idle") return "Idle";
	if (phase === "running") return "Running";
	return "Tests";
};

export const RunSummary: FC<RunSummaryProps> = ({ phase, totals }) => {
	const total = totals.passCount + totals.failCount + totals.skipCount;
	const passColor = totals.failCount > 0 ? "yellow" : "green";

	return (
		<Box>
			<Text>{phaseLabel(phase)}: </Text>
			<Text color={passColor} bold>
				{totals.passCount}/{total} passed
			</Text>
			{totals.failCount > 0 ? (
				<Text color="red">
					{", "}
					{totals.failCount} failed
				</Text>
			) : null}
			{totals.skipCount > 0 ? (
				<Text color="gray">
					{", "}
					{totals.skipCount} skipped
				</Text>
			) : null}
			<Text dimColor> ({totals.durationMs}ms)</Text>
		</Box>
	);
};

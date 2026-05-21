/**
 * Single-test row: status glyph, name (with suite prefix when nested), and duration.
 *
 * @packageDocumentation
 */

import { Box, Text } from "ink";
import type { FC } from "react";
import type { TestRecord } from "vitest-agent-sdk";
import { formatDisplayDuration } from "../format-duration.js";
import type { StatusIconKind } from "./StatusIcon.js";
import { StatusIcon } from "./StatusIcon.js";

export interface TestRowProps {
	readonly test: TestRecord;
	readonly indent?: number;
}

const testGlyph = (status: TestRecord["status"]): StatusIconKind => status;

export const TestRow: FC<TestRowProps> = ({ test, indent = 2 }) => {
	const pad = " ".repeat(indent);
	const suite = test.suitePath.length > 0 ? `${test.suitePath.join(" > ")} > ` : "";
	const duration = test.durationMs !== null ? ` (${formatDisplayDuration(test.durationMs)})` : "";

	return (
		<Box>
			<Text>{pad}</Text>
			<StatusIcon status={testGlyph(test.status)} />
			<Text>
				{" "}
				{suite}
				{test.testName}
			</Text>
			<Text dimColor>{duration}</Text>
		</Box>
	);
};

/**
 * Single-test row: status glyph, name (with suite prefix when nested), and duration.
 */

import type { TestRecord } from "@vitest-agent/sdk";
import { Box, Text } from "ink";
import type { FC } from "react";
import { formatDisplayDuration } from "../format-duration.js";
import type { StatusIconKind } from "./StatusIcon.js";
import { StatusIcon } from "./StatusIcon.js";

/**
 * Props for the `TestRow` component.
 *
 * @public
 */
export interface TestRowProps {
	/** The test record to display. */
	readonly test: TestRecord;
	/** Leading indentation in spaces; defaults to 2. */
	readonly indent?: number;
}

const testGlyph = (status: TestRecord["status"]): StatusIconKind => status;

/**
 * Renders one test row: status glyph, optional suite prefix, test name, and duration.
 *
 * @public
 */
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

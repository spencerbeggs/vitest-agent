/**
 * Ink rendering helpers shared by the dispatcher cells.
 *
 * Most cells re-express their agent-half string in a simple
 * `<Box flexDirection="column">` with one `<Text>` per line plus
 * targeted color coding on glyph characters (✓ green, ✗ red,
 * Trend regressing/improving in matching colors).
 *
 * @packageDocumentation
 */

import { Box, Text } from "ink";
import type { ReactElement } from "react";
import * as React from "react";

/**
 * Render an agent-string output as a column of Ink Text rows, applying
 * color to the leading status glyph on each line.
 */
export const renderAgentStringAsInk = (agentString: string): ReactElement => {
	const lines = agentString.split("\n");
	return (
		<Box flexDirection="column">
			{lines.map((line, idx) => (
				<Text key={`${idx}-${line}`}>{colorize(line)}</Text>
			))}
		</Box>
	);
};

const PASS_GLYPH = "✓";
const FAIL_GLYPH = "✗";

const colorize = (line: string): ReactElement | string => {
	const trimmed = line.trimStart();
	if (trimmed.startsWith(PASS_GLYPH)) {
		return (
			<>
				<Text color="green">{PASS_GLYPH}</Text>
				{line.slice(line.indexOf(PASS_GLYPH) + 1)}
			</>
		);
	}
	if (trimmed.startsWith(FAIL_GLYPH)) {
		return (
			<>
				<Text color="red">{FAIL_GLYPH}</Text>
				{line.slice(line.indexOf(FAIL_GLYPH) + 1)}
			</>
		);
	}
	if (line.startsWith("Trend: regressing")) {
		return <Text color="yellow">{line}</Text>;
	}
	if (line.startsWith("Trend: improving")) {
		return <Text color="green">{line}</Text>;
	}
	if (line.startsWith("Coverage: ✓")) {
		return <Text color="green">{line}</Text>;
	}
	if (line.startsWith("Coverage: ✗")) {
		return <Text color="red">{line}</Text>;
	}
	if (line.startsWith("Failures:")) {
		return <Text bold>{line}</Text>;
	}
	if (line.startsWith("Use `")) {
		return <Text dimColor>{line}</Text>;
	}
	return line;
};

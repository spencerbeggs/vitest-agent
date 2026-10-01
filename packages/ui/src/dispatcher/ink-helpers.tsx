/**
 * Ink rendering helpers shared by the dispatcher cells.
 *
 * Most cells re-express their agent-half string in a simple
 * `<Box flexDirection="column">` with one `<Text>` per line plus
 * targeted styling on status glyphs and line prefixes, all drawn from
 * the shared `VitestAgentStatus` vocabulary and theme tokens.
 *
 * @packageDocumentation
 */

import type { TokenName } from "@effected/cli";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { VitestAgentStatusName } from "../theme.js";
import { inkStyle, statusGlyph, statusInkStyle } from "../theme.js";

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

const SUCCESS_GLYPH = statusGlyph("success");
const FAILURE_GLYPH = statusGlyph("failure");

/** Paint the leading status glyph of a line in its vocabulary style. */
const glyphLine = (line: string, glyph: string, status: VitestAgentStatusName): ReactElement => {
	const idx = line.indexOf(glyph);
	return (
		<>
			{line.slice(0, idx)}
			<Text {...statusInkStyle(status)}>{glyph}</Text>
			{line.slice(idx + glyph.length)}
		</>
	);
};

/**
 * Whole-line styles keyed on the agent string's line prefixes. A
 * regressing trend is a `warning`; a coverage threshold failure is a
 * `failure` (the kit's drift decisions).
 */
const LINE_STYLES: ReadonlyArray<readonly [prefix: string, token: TokenName]> = [
	["Trend: regressing", "warning"],
	["Trend: improving", "success"],
	[`Coverage: ${SUCCESS_GLYPH}`, "success"],
	[`Coverage: ${FAILURE_GLYPH}`, "failure"],
	["Failures:", "emphasis"],
	["Use `", "muted"],
];

const colorize = (line: string): ReactElement | string => {
	const trimmed = line.trimStart();
	if (trimmed.startsWith(SUCCESS_GLYPH)) return glyphLine(line, SUCCESS_GLYPH, "success");
	if (trimmed.startsWith(FAILURE_GLYPH)) return glyphLine(line, FAILURE_GLYPH, "failure");
	for (const [prefix, token] of LINE_STYLES) {
		if (line.startsWith(prefix)) return <Text {...inkStyle(token)}>{line}</Text>;
	}
	return line;
};

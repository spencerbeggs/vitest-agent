/**
 * The four-outcome count columns for an aggregate row (a project or a
 * module): pass, fail, skip, timeout. All four always render — a zero
 * is dimmed, never omitted — so the columns line up across rows.
 */

import type { GlyphSet } from "@effected/cli";
import { Text } from "ink";
import type { FC } from "react";
import type { VitestAgentStatusName } from "../theme.js";
import { VitestAgentTokens, inkStyle, statusGlyph, statusInkStyle } from "../theme.js";
import { useGlyphs } from "./glyphs.js";

/**
 * Props for the `CountColumns` component.
 *
 * @public
 */
export interface CountColumnsProps {
	/** Number of passing tests. */
	readonly passCount: number;
	/** Number of failing tests. */
	readonly failCount: number;
	/** Number of skipped tests. */
	readonly skipCount: number;
	/** Number of timed-out tests. */
	readonly timeoutCount: number;
}

/**
 * Fixed width of the duration cell that follows the count columns on an
 * aggregate row — sized for the formatter's widest common output
 * (`59m 59s`). Longer values overflow their row rather than truncate.
 *
 * @public
 */
export const DURATION_CELL_WIDTH = 7;

const cell = (count: number, status: VitestAgentStatusName, glyphs: GlyphSet) => (
	<Text {...(count > 0 ? statusInkStyle(status) : inkStyle(VitestAgentTokens.zero))}>
		{String(count).padStart(4)}
		{statusGlyph(status, glyphs)}
	</Text>
);

/**
 * Renders four colored count columns (pass ✓, fail ✗, skip ↷, timeout ⧖)
 * for an aggregate row. Counts render right-aligned in fixed 4-digit cells so
 * columns align across rows; counts of 10,000+ overflow their row without
 * truncation. Zeros are greyed; all four columns always appear. Glyphs and
 * colours come from `VitestAgentStatus` (skip is `muted`).
 *
 * @public
 */
export const CountColumns: FC<CountColumnsProps> = ({ passCount, failCount, skipCount, timeoutCount }) => {
	const glyphs = useGlyphs();
	return (
		<Text>
			{cell(passCount, "success", glyphs)}
			{"  "}
			{cell(failCount, "failure", glyphs)}
			{"  "}
			{cell(skipCount, "skip", glyphs)}
			{"  "}
			{cell(timeoutCount, "timeout", glyphs)}
		</Text>
	);
};

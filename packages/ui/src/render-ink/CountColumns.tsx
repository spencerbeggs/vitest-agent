/**
 * The four-outcome count columns for an aggregate row (a project or a
 * module): pass, fail, skip, timeout. All four always render — a zero
 * is dimmed, never omitted — so the columns line up across rows.
 */

import { Text } from "ink";
import type { FC } from "react";

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
 * (`999.9ms`). Longer values overflow their row rather than truncate.
 *
 * @public
 */
export const DURATION_CELL_WIDTH = 7;

const cell = (count: number, glyph: string, color: string) => (
	<Text color={count > 0 ? color : "gray"}>
		{String(count).padStart(4)}
		{glyph}
	</Text>
);

/**
 * Renders four colored count columns (pass ✓, fail ✗, skip ↷, timeout ⧖)
 * for an aggregate row. Counts render right-aligned in fixed 4-digit cells so
 * columns align across rows; counts of 10,000+ overflow their row without
 * truncation. Zeros are dimmed; all four columns always appear.
 *
 * @public
 */
export const CountColumns: FC<CountColumnsProps> = ({ passCount, failCount, skipCount, timeoutCount }) => (
	<Text>
		{cell(passCount, "✓", "green")}
		{"  "}
		{cell(failCount, "✗", "red")}
		{"  "}
		{cell(skipCount, "↷", "yellow")}
		{"  "}
		{cell(timeoutCount, "⧖", "#e09a4e")}
	</Text>
);

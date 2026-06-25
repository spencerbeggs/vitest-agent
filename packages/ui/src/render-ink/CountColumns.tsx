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

const cell = (count: number, glyph: string, color: string) =>
	count > 0 ? (
		<Text color={color}>
			{count}
			{glyph}
		</Text>
	) : (
		<Text color="gray">
			{count}
			{glyph}
		</Text>
	);

/**
 * Renders four colored count columns (pass ✓, fail ✗, skip ↷, timeout ⧖)
 * for an aggregate row. Zeros are dimmed; all four columns always appear.
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

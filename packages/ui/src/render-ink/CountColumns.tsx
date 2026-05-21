/**
 * The four-outcome count columns for an aggregate row (a project or a
 * module): pass, fail, skip, timeout. All four always render — a zero
 * is dimmed, never omitted — so the columns line up across rows.
 *
 * @packageDocumentation
 */

import { Text } from "ink";
import type { FC } from "react";

export interface CountColumnsProps {
	readonly passCount: number;
	readonly failCount: number;
	readonly skipCount: number;
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

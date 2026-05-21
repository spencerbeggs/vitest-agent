/**
 * The one-line trend signal — `Trend: <direction> (<N> runs)`.
 *
 * @packageDocumentation
 */

import { Text } from "ink";
import type { FC } from "react";

export interface TrendLineProps {
	readonly trend: { readonly direction: "improving" | "regressing" | "stable"; readonly runCount: number };
}

const COLOR: Record<TrendLineProps["trend"]["direction"], string> = {
	improving: "green",
	regressing: "red",
	stable: "gray",
};

export const TrendLine: FC<TrendLineProps> = ({ trend }) => {
	const runs = trend.runCount === 1 ? "1 run" : `${trend.runCount} runs`;
	return (
		<Text>
			<Text bold>Trend:</Text> <Text color={COLOR[trend.direction]}>{trend.direction}</Text>
			<Text dimColor> ({runs})</Text>
		</Text>
	);
};

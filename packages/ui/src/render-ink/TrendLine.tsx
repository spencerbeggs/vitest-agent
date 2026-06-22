/**
 * The one-line trend signal — `Trend: <direction> (<N> runs)`.
 */

import { Text } from "ink";
import type { FC } from "react";

/**
 * Props for the `TrendLine` component.
 *
 * @public
 */
export interface TrendLineProps {
	/** The trend summary to display. */
	readonly trend: { readonly direction: "improving" | "regressing" | "stable"; readonly runCount: number };
}

const COLOR: Record<TrendLineProps["trend"]["direction"], string> = {
	improving: "green",
	regressing: "red",
	stable: "gray",
};

/**
 * Renders the one-line trend signal: direction (colored) and run count.
 *
 * @public
 */
export const TrendLine: FC<TrendLineProps> = ({ trend }) => {
	const runs = trend.runCount === 1 ? "1 run" : `${trend.runCount} runs`;
	return (
		<Text>
			<Text bold>Trend:</Text> <Text color={COLOR[trend.direction]}>{trend.direction}</Text>
			<Text dimColor> ({runs})</Text>
		</Text>
	);
};

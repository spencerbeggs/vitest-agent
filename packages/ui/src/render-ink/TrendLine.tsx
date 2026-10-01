/**
 * The one-line trend signal — `Trend: <direction> (<N> runs)`.
 */

import type { Style, TokenName } from "@effected/cli";
import { Fmt } from "@effected/cli";
import { Text } from "ink";
import type { FC } from "react";
import { VitestAgentTokens, inkStyle } from "../theme.js";

/**
 * Props for the `TrendLine` component.
 *
 * @public
 */
export interface TrendLineProps {
	/** The trend summary to display. */
	readonly trend: { readonly direction: "improving" | "regressing" | "stable"; readonly runCount: number };
}

/** A regressing trend is a `warning`, not a failure (the kit's drift decision). */
const TOKEN: Record<TrendLineProps["trend"]["direction"], TokenName | Style> = {
	improving: "success",
	regressing: "warning",
	stable: VitestAgentTokens.stable,
};

/**
 * Renders the one-line trend signal: direction (colored) and run count.
 *
 * @public
 */
export const TrendLine: FC<TrendLineProps> = ({ trend }) => {
	const runs = Fmt.plural(trend.runCount, "run");
	return (
		<Text>
			<Text bold>Trend:</Text> <Text {...inkStyle(TOKEN[trend.direction])}>{trend.direction}</Text>
			<Text dimColor> ({runs})</Text>
		</Text>
	);
};

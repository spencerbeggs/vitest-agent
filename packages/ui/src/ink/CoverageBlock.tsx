/**
 * Coverage section: per-metric percentage, threshold violations, top-N gaps.
 */

import { Fmt } from "@effected/cli";
import type { CoverageRenderState } from "@vitest-agent/sdk";
import { Box, Text } from "ink";
import type { FC } from "react";
import { inkStyle } from "../theme.js";

/**
 * Props for the `CoverageBlock` component.
 *
 * @public
 */
export interface CoverageBlockProps {
	/** The coverage render state to display. */
	readonly coverage: CoverageRenderState;
	/** Maximum number of gap entries to list; defaults to 3. */
	readonly maxGaps?: number;
}

const METRIC_ORDER = ["lines", "branches", "functions", "statements"] as const;

/** Coverage metrics arrive on istanbul's 0–100 scale. */
const formatPercent = (n: number): string => Fmt.percent(n, { scale: 100 });

/** A metric below its threshold is a coverage threshold failure: the kit's `failure` token. */
const FAILURE = inkStyle("failure");

/**
 * Renders the coverage section: per-metric percentages, threshold
 * violations, and top-N gap entries sorted by missing line count.
 *
 * @public
 */
export const CoverageBlock: FC<CoverageBlockProps> = ({ coverage, maxGaps = 3 }) => {
	const sortedGaps = [...coverage.gaps].sort((a, b) => b.missing.lines - a.missing.lines);
	const topGaps = maxGaps > 0 ? sortedGaps.slice(0, maxGaps) : [];
	const elidedGaps = maxGaps > 0 ? coverage.gaps.length - topGaps.length : 0;

	return (
		<Box flexDirection="column">
			<Text bold>Coverage</Text>
			{METRIC_ORDER.map((metric) => {
				const actual = coverage.metrics[metric];
				const threshold = coverage.thresholds[metric];
				const failing = threshold !== undefined && actual < threshold;
				return (
					<Box key={metric}>
						<Text>{`  ${metric}: `}</Text>
						{failing ? <Text {...FAILURE}>{formatPercent(actual)}</Text> : <Text>{formatPercent(actual)}</Text>}
						{threshold !== undefined ? <Text dimColor> (threshold {formatPercent(threshold)})</Text> : null}
					</Box>
				);
			})}
			{coverage.violations.length > 0 ? (
				<Box flexDirection="column">
					<Text {...FAILURE}>Violations</Text>
					{coverage.violations.map((v) => (
						<Text key={v.metric} {...FAILURE}>
							{`  ${v.metric}: ${formatPercent(v.actual)} < ${formatPercent(v.expected)}`}
						</Text>
					))}
				</Box>
			) : null}
			{topGaps.length > 0 ? (
				<Box flexDirection="column">
					<Text bold>Gaps</Text>
					{topGaps.map((g) => (
						<Text key={g.file}>
							{`  ${g.file}`}
							{g.uncoveredLines !== undefined ? `: ${g.uncoveredLines}` : ""}
						</Text>
					))}
					{elidedGaps > 0 ? <Text dimColor>{`  (+${Fmt.plural(elidedGaps, "more gap", "more gaps")})`}</Text> : null}
				</Box>
			) : null}
		</Box>
	);
};

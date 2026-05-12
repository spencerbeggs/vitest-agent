/**
 * Coverage section: per-metric percentage, threshold violations, top-N gaps.
 *
 * @packageDocumentation
 */

import { Box, Text } from "ink";
import type { FC } from "react";
import * as React from "react";
import type { CoverageRenderState } from "vitest-agent-sdk";

export interface CoverageBlockProps {
	readonly coverage: CoverageRenderState;
	readonly maxGaps?: number;
}

const METRIC_ORDER = ["lines", "branches", "functions", "statements"] as const;

const formatPercent = (n: number): string => {
	const rounded = Math.round(n * 10) / 10;
	return `${rounded}%`;
};

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
						{failing ? <Text color="red">{formatPercent(actual)}</Text> : <Text>{formatPercent(actual)}</Text>}
						{threshold !== undefined ? <Text dimColor> (threshold {formatPercent(threshold)})</Text> : null}
					</Box>
				);
			})}
			{coverage.violations.length > 0 ? (
				<Box flexDirection="column">
					<Text color="red">Violations</Text>
					{coverage.violations.map((v) => (
						<Text key={v.metric} color="red">
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
					{elidedGaps > 0 ? (
						<Text dimColor>{`  (+${elidedGaps} more ${elidedGaps === 1 ? "gap" : "gaps"})`}</Text>
					) : null}
				</Box>
			) : null}
		</Box>
	);
};

/**
 * The capped failures block for aggregate-row shapes (workspace,
 * single-project) — the rows there are projects or modules and cannot
 * expand a per-test error inline, so the failures collect here.
 *
 * Each entry: a glyph (⧖ for a timed-out failure, ✗ otherwise), the
 * `module › suite › test` path, the classification tag when known, and
 * one indented line — the first line of the error message.
 *
 * @packageDocumentation
 */

import type { FailureRecord } from "@vitest-agent/sdk";
import { Box, Text } from "ink";
import type { FC } from "react";

export interface FailuresSectionProps {
	readonly failures: ReadonlyArray<FailureRecord>;
	/** Maximum entries to list before collapsing the rest into an overflow line. */
	readonly limit: number;
}

const pathOf = (f: FailureRecord): string => {
	const segments = [f.modulePath, ...f.suitePath, f.testName];
	return segments.join(" › ");
};

const firstLine = (message: string): string => message.split("\n", 1)[0] ?? "";

const FAILURE_VALUE_LIMIT = 200;

export const FailuresSection: FC<FailuresSectionProps> = ({ failures, limit }) => {
	const shown = failures.slice(0, limit);
	const overflow = failures.length - shown.length;
	return (
		<Box flexDirection="column">
			<Text bold>Failures ({failures.length}):</Text>
			{shown.map((f, i) => (
				<Box key={`${f.modulePath}:${f.testName}:${i}`} flexDirection="column">
					<Text>
						{"  "}
						<Text color={f.timedOut === true ? "#e09a4e" : "red"}>{f.timedOut === true ? "⧖" : "✗"}</Text> {pathOf(f)}
						{f.classification !== null ? <Text color="#c98ae0"> [{f.classification}]</Text> : null}
					</Text>
					{f.error?.message !== undefined ? (
						<Text dimColor>
							{"      "}
							{firstLine(f.error.message)}
						</Text>
					) : null}
					{f.error?.expected !== undefined ? (
						<Text dimColor>
							{"      "}
							{"expected: "}
							{f.error.expected.slice(0, FAILURE_VALUE_LIMIT)}
						</Text>
					) : null}
					{f.error?.received !== undefined ? (
						<Text dimColor>
							{"      "}
							{"received: "}
							{f.error.received.slice(0, FAILURE_VALUE_LIMIT)}
						</Text>
					) : null}
				</Box>
			))}
			{overflow > 0 ? <Text dimColor>{`  … ${overflow} more`}</Text> : null}
		</Box>
	);
};

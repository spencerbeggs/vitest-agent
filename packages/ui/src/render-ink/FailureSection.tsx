/**
 * Failure list: one block per failed test with classification, message,
 * diff, and optionally stack trace.
 *
 * @packageDocumentation
 */

import type { FailureRecord } from "@vitest-agent/sdk";
import { Box, Text } from "ink";
import type { FC } from "react";

export interface FailureSectionProps {
	readonly failures: ReadonlyArray<FailureRecord>;
	readonly includeStack?: boolean;
}

const FailureRow: FC<{ failure: FailureRecord; includeStack: boolean }> = ({ failure, includeStack }) => {
	const suite = failure.suitePath.length > 0 ? `${failure.suitePath.join(" > ")} > ` : "";
	const classification = failure.classification !== null ? ` [${failure.classification}]` : "";

	return (
		<Box flexDirection="column">
			<Box>
				<Text>
					<Text color="red">✗</Text>
					{` ${failure.modulePath} > ${suite}${failure.testName}`}
					{failure.classification !== null ? <Text color="yellow">{classification}</Text> : null}
				</Text>
			</Box>
			{failure.error?.message !== undefined ? (
				<Text color="red">{`  ${failure.error.message.split("\n", 1)[0] ?? ""}`}</Text>
			) : null}
			{failure.error?.diff !== undefined
				? failure.error.diff.split("\n").map((line, idx) => {
						const key = `diff-${idx}`;
						if (line.startsWith("-")) {
							return (
								<Text key={key} color="red">
									{`  ${line}`}
								</Text>
							);
						}
						if (line.startsWith("+")) {
							return (
								<Text key={key} color="green">
									{`  ${line}`}
								</Text>
							);
						}
						return <Text key={key}>{`  ${line}`}</Text>;
					})
				: null}
			{includeStack && failure.error?.stack !== undefined
				? failure.error.stack.split("\n").map((line, idx) => {
						const key = `stack-${idx}`;
						return (
							<Text key={key} dimColor>
								{`  ${line}`}
							</Text>
						);
					})
				: null}
		</Box>
	);
};

export const FailureSection: FC<FailureSectionProps> = ({ failures, includeStack = false }) => {
	if (failures.length === 0) return null;
	return (
		<Box flexDirection="column">
			<Text bold>Failures</Text>
			{failures.map((failure) => (
				<FailureRow
					key={`${failure.modulePath}::${failure.suitePath.join("/")}::${failure.testName}`}
					failure={failure}
					includeStack={includeStack}
				/>
			))}
		</Box>
	);
};

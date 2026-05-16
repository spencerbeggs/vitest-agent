/**
 * Suggested-actions queue: severity-prefixed action rows with optional tool hint.
 *
 * @packageDocumentation
 */

import { Box, Text } from "ink";
import type { FC } from "react";
import type { ActionSeverity, SuggestedActionRecord } from "vitest-agent-sdk";

export interface SuggestedActionsProps {
	readonly actions: ReadonlyArray<SuggestedActionRecord>;
}

const SEVERITY_COLOR: Record<ActionSeverity, string> = {
	info: "blue",
	warn: "yellow",
	blocker: "red",
};

export const SuggestedActions: FC<SuggestedActionsProps> = ({ actions }) => {
	if (actions.length === 0) return null;
	return (
		<Box flexDirection="column">
			<Text bold>Actions</Text>
			{actions.map((action, idx) => (
				<Box key={`${action.severity}-${idx}-${action.title}`} flexDirection="column">
					<Box>
						<Text color={SEVERITY_COLOR[action.severity]} bold>
							{`  ${action.severity}: `}
						</Text>
						<Text>{action.title}</Text>
						{action.targetTool !== undefined ? <Text dimColor> (tool: {action.targetTool})</Text> : null}
					</Box>
					<Text dimColor>{`    ${action.detail}`}</Text>
				</Box>
			))}
		</Box>
	);
};

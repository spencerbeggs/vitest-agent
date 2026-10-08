/**
 * Suggested-actions queue: severity-prefixed action rows with optional tool hint.
 */

import type { Style, TokenName } from "@effected/cli";
import { Token } from "@effected/cli";
import type { ActionSeverity, SuggestedActionRecord } from "@vitest-agent/sdk";
import { Box, Text } from "ink";
import type { FC } from "react";
import { inkStyle } from "../theme.js";

/**
 * Props for the `SuggestedActions` component.
 *
 * @public
 */
export interface SuggestedActionsProps {
	/** The list of suggested actions to display. */
	readonly actions: ReadonlyArray<SuggestedActionRecord>;
}

const SEVERITY_TOKEN: Record<ActionSeverity, TokenName | Style> = {
	info: Token.named("blue"),
	warn: "warning",
	blocker: "failure",
};

/**
 * Renders the suggested-actions queue as severity-prefixed rows with
 * optional tool hints. Returns `null` when the actions list is empty.
 *
 * @public
 */
export const SuggestedActions: FC<SuggestedActionsProps> = ({ actions }) => {
	if (actions.length === 0) return null;
	return (
		<Box flexDirection="column">
			<Text bold>Actions</Text>
			{actions.map((action, idx) => (
				<Box key={`${action.severity}-${idx}-${action.title}`} flexDirection="column">
					<Box>
						<Text {...inkStyle(SEVERITY_TOKEN[action.severity])} bold>
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

/**
 * Suggested-actions queue: severity-prefixed action rows with optional tool hint.
 */

import type { Style, TokenName } from "@effected/cli-kit";
import { Token } from "@effected/cli-kit";
import { useStyle } from "@effected/cli-kit/ui";
import type { ActionSeverity, SuggestedActionRecord } from "@vitest-agent/sdk";
import { Box, Text } from "ink";
import type { FC } from "react";

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

/** One action's bold severity label: a component so the hook runs once per row. */
const SeverityLabel: FC<{ readonly severity: ActionSeverity }> = ({ severity }) => {
	const style = useStyle(SEVERITY_TOKEN[severity]);
	return <Text {...style} bold>{`  ${severity}: `}</Text>;
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
						<SeverityLabel severity={action.severity} />
						<Text>{action.title}</Text>
						{action.targetTool !== undefined ? <Text dimColor> (tool: {action.targetTool})</Text> : null}
					</Box>
					<Text dimColor>{`    ${action.detail}`}</Text>
				</Box>
			))}
		</Box>
	);
};

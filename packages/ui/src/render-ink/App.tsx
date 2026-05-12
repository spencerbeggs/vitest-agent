/**
 * Root Ink component composing the leaf sections into one live view.
 *
 * Receives the full {@link RenderState} as props and lays out sections
 * in the same order as the agent renderer: header, failures, modules,
 * coverage, suggested actions. Sections are omitted when their slice
 * of state is empty.
 *
 * In live (plugin) mode the host wraps an `App` instance in a fiber
 * that subscribes to a `PubSub<RunEvent>`, runs the reducer, and
 * rerenders on each state change. In replay (CLI) mode the host
 * builds the state synchronously and renders once.
 *
 * @packageDocumentation
 */

import { Box } from "ink";
import type { FC } from "react";
import * as React from "react";
import type { ModuleRecord, RenderState } from "vitest-agent-sdk";
import { CoverageBlock } from "./CoverageBlock.js";
import { FailureSection } from "./FailureSection.js";
import { ModuleRow } from "./ModuleRow.js";
import { RunSummary } from "./RunSummary.js";
import { SuggestedActions } from "./SuggestedActions.js";

export interface AppProps {
	readonly state: RenderState;
	readonly options?: AppOptions;
}

export interface AppOptions {
	/** Cap the per-coverage-gap listing. Default 3. Set 0 to omit gaps entirely. */
	readonly maxCoverageGaps?: number;
	/** Include stack traces in the failure block. Default false. */
	readonly includeStack?: boolean;
	/** Show child test rows under each module. Default false (header only). */
	readonly showModuleTests?: boolean;
}

const orderedModules = (state: RenderState): ModuleRecord[] =>
	state.moduleOrder.map((path) => state.modules[path]).filter((m): m is ModuleRecord => m !== undefined);

export const App: FC<AppProps> = ({ state, options = {} }) => {
	const modules = orderedModules(state);
	const showFailures = state.failures.length > 0;
	const showModulesBlock = modules.length > 0;
	const showCoverage = state.coverage !== null;
	const showActions = state.suggestedActions.length > 0;

	return (
		<Box flexDirection="column">
			<RunSummary phase={state.phase} totals={state.totals} />

			{showFailures ? (
				<Box flexDirection="column" marginTop={1}>
					<FailureSection failures={state.failures} includeStack={options.includeStack ?? false} />
				</Box>
			) : null}

			{showModulesBlock ? (
				<Box flexDirection="column" marginTop={1}>
					{modules.map((module) => (
						<ModuleRow key={module.modulePath} module={module} showTests={options.showModuleTests ?? false} />
					))}
				</Box>
			) : null}

			{showCoverage && state.coverage !== null ? (
				<Box flexDirection="column" marginTop={1}>
					<CoverageBlock coverage={state.coverage} maxGaps={options.maxCoverageGaps ?? 3} />
				</Box>
			) : null}

			{showActions ? (
				<Box flexDirection="column" marginTop={1}>
					<SuggestedActions actions={state.suggestedActions} />
				</Box>
			) : null}
		</Box>
	);
};

import type { HistoryRecord, TestClassification } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import { HistoryTracker } from "../services/HistoryTracker.js";
/** @public */
export interface HistoryTrackerTestState {
	readonly classifyCalls: Array<{
		project: string;
		timestamp: string;
	}>;
}
/** @public */
export const HistoryTrackerTest = {
	empty: (): HistoryTrackerTestState => ({
		classifyCalls: [],
	}),
	layer: (
		state: HistoryTrackerTestState,
		cannedResult?: {
			history: HistoryRecord;
			classifications: Map<string, TestClassification>;
		},
	): Layer.Layer<HistoryTracker> =>
		Layer.succeed(HistoryTracker, {
			classify: (project, _outcomes, timestamp) =>
				Effect.sync(() => {
					(state.classifyCalls as Array<{ project: string; timestamp: string }>).push({
						project,
						timestamp,
					});
					return (
						cannedResult ?? {
							history: { project, updatedAt: timestamp, tests: [] },
							classifications: new Map(),
						}
					);
				}),
		}),
} as const;

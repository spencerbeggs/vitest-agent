import { Effect, Layer } from "effect";
import type { TestClassification } from "../schemas/Common.js";
import type { TestRun } from "../schemas/History.js";
import { DataReader } from "../services/DataReader.js";
import { HistoryTracker } from "../services/HistoryTracker.js";
import { classifyTest } from "../utils/classify-test.js";

interface MutableTestHistory {
	fullName: string;
	runs: Array<TestRun>;
}

const WINDOW_SIZE = 10;
/** @public */
export const HistoryTrackerLive: Layer.Layer<HistoryTracker, never, DataReader> = Layer.effect(
	HistoryTracker,
	Effect.gen(function* () {
		const reader = yield* DataReader;
		return {
			classify: (project, testOutcomes, timestamp) =>
				Effect.gen(function* () {
					const existing = yield* reader.getHistory(project);
					const testMap = new Map<string, MutableTestHistory>();
					for (const entry of existing.tests) {
						testMap.set(entry.fullName, { ...entry, runs: [...entry.runs] });
					}

					const classifications = new Map<string, TestClassification>();

					for (const outcome of testOutcomes) {
						let entry = testMap.get(outcome.fullName);
						if (!entry) {
							entry = { fullName: outcome.fullName, runs: [] };
							testMap.set(outcome.fullName, entry);
						}

						const priorRuns = entry.runs;
						entry.runs = [{ timestamp, state: outcome.state }, ...priorRuns].slice(0, WINDOW_SIZE);

						classifications.set(outcome.fullName, classifyTest(outcome.state, priorRuns));
					}

					return {
						history: {
							project,
							updatedAt: timestamp,
							tests: Array.from(testMap.values()),
						},
						classifications,
					};
				}),
		};
	}),
);

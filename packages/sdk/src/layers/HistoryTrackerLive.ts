import { Effect, Layer } from "effect";
import type { TestClassification } from "../schemas/Common.js";
import type { TestRun } from "../schemas/History.js";
import { DataReader } from "../services/DataReader.js";
import { HistoryTracker, historyKey } from "../services/HistoryTracker.js";
import { classifyTest } from "../utils/classify-test.js";

interface MutableTestHistory {
	modulePath: string;
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
						testMap.set(historyKey(entry.modulePath, entry.fullName), { ...entry, runs: [...entry.runs] });
					}

					const classifications = new Map<string, TestClassification>();

					for (const outcome of testOutcomes) {
						const key = historyKey(outcome.modulePath, outcome.fullName);
						let entry = testMap.get(key);
						if (!entry) {
							entry = { modulePath: outcome.modulePath, fullName: outcome.fullName, runs: [] };
							testMap.set(key, entry);
						}

						const priorRuns = entry.runs;
						entry.runs = [{ timestamp, state: outcome.state }, ...priorRuns].slice(0, WINDOW_SIZE);

						classifications.set(key, classifyTest(outcome.state, priorRuns));
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

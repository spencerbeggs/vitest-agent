import type { Effect } from "effect";
import { Context } from "effect";
import type { DataStoreError } from "../errors/DataStoreError.js";
import type { TestClassification } from "../schemas/Common.js";
import type { HistoryRecord } from "../schemas/History.js";

/**
 * Lightweight test outcome for history classification.
 */
export interface TestOutcome {
	readonly fullName: string;
	readonly state: "passed" | "failed";
}

export class HistoryTracker extends Context.Tag("vitest-agent/HistoryTracker")<
	HistoryTracker,
	{
		readonly classify: (
			project: string,
			testOutcomes: ReadonlyArray<TestOutcome>,
			timestamp: string,
		) => Effect.Effect<
			{
				history: HistoryRecord;
				classifications: Map<string, TestClassification>;
			},
			DataStoreError
		>;
	}
>() {}

import type { Effect } from "effect";
import { Context } from "effect";
import type { DataStoreError } from "../errors/DataStoreError.js";
import type { TestClassification } from "../schemas/Common.js";
import type { HistoryRecord } from "../schemas/History.js";

/**
 * Lightweight test outcome for history classification.
 * @public
 */
export interface TestOutcome {
	readonly modulePath: string;
	readonly fullName: string;
	readonly state: "passed" | "failed";
}

/**
 * Builds the composite (modulePath, fullName) key used to key the internal
 * testMap and the returned classifications Map, so identically-named tests
 * in different files classify independently instead of colliding.
 * @public
 */
export const historyKey = (modulePath: string, fullName: string): string => `${modulePath} ${fullName}`;
/** @public */
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

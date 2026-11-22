/**
 * Issue 735: per-attempt results reach `test_errors` (which attempt raised
 * each error) and `test_history` (the latest run's retried tests with every
 * attempt), and the `why-flaky` prompt points the agent at them.
 */

import { DataStore } from "@vitest-agent/engine";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { whyFlakyPrompt } from "../src/prompts/why-flaky.js";
import type { HarnessOptions, McpHarness } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

interface CallToolResult {
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

const PROJECT = "flaky-proj";

/** One test that failed its first attempt and passed the retry. */
const seed: Effect.Effect<void, never, DataStore> = Effect.gen(function* () {
	const store = yield* DataStore;
	yield* store.writeSettings("h", { vitestVersion: "5.1.0" }, {});
	const runId = yield* store.writeRun({
		invocationId: "i1",
		project: PROJECT,
		settingsHash: "h",
		timestamp: "2026-03-01T00:00:00.000Z",
		commitSha: null,
		branch: null,
		reason: "passed",
		duration: 1,
		total: 1,
		passed: 1,
		failed: 0,
		skipped: 0,
		scoped: false,
	});
	const fileId = yield* store.ensureFile("src/a.test.ts");
	const [moduleId] = yield* store.writeModules(runId, [{ fileId, relativeModuleId: "src/a.test.ts", state: "passed" }]);
	const [testCaseId] = yield* store.writeTestCases(moduleId, [
		{ name: "flaky", fullName: "flaky", state: "passed", retryCount: 1 },
	]);
	const [failedAttempt] = yield* store.writeTestAttempts(testCaseId, [
		{ retryIndex: 0, repeatIndex: 0, state: "failed", duration: 5, startTime: 100 },
		{ retryIndex: 1, repeatIndex: 0, state: "passed", duration: 3, startTime: 110 },
	]);
	yield* store.writeErrors(runId, [
		{ testCaseId, scope: "test", message: "first try", name: "AssertionError", attemptId: failedAttempt },
	]);
}).pipe(Effect.orDie);

const SEEDED: HarnessOptions = { seed };

const withHarness = <A>(f: (harness: McpHarness) => Effect.Effect<A>, options?: HarnessOptions): Promise<A> =>
	Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness(options), f)));

const call = (name: string, args: unknown): Promise<CallToolResult> =>
	withHarness((h) => h.initialize().pipe(Effect.andThen(h.callTool(name, args))), SEEDED) as Promise<CallToolResult>;

describe("per-attempt results on the query tools (issue 735)", () => {
	it("test_errors names the attempt that raised each error", async () => {
		const result = await call("test_errors", { project: PROJECT });
		expect(result.isError).toBe(false);
		const errors = result.structuredContent?.errors as Array<{ message: string; attempt: unknown }>;
		expect(errors).toHaveLength(1);
		expect(errors[0].attempt).toEqual({ retryIndex: 0, repeatIndex: 0 });
	});

	it("test_history lists the latest run's retried tests with every attempt", async () => {
		const result = await call("test_history", { project: PROJECT });
		expect(result.isError).toBe(false);
		const retried = result.structuredContent?.retried as Array<{
			fullName: string;
			modulePath: string;
			attempts: Array<{ retryIndex: number; state: string; errorIds: number[] }>;
		}>;
		expect(retried).toHaveLength(1);
		expect(retried[0]).toMatchObject({ fullName: "flaky", modulePath: "src/a.test.ts" });
		expect(retried[0].attempts.map((a) => [a.retryIndex, a.state, a.errorIds.length])).toEqual([
			[0, "failed", 1],
			[1, "passed", 0],
		]);
	});

	it("why-flaky tells the agent to read the per-attempt results", () => {
		const text = whyFlakyPrompt({ test: "x" }).messages[0].content.text;
		expect(text).toContain("retried");
		expect(text).toContain("attempt");
	});
});

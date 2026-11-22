/**
 * Issue 737: the failed attempt's trace-timeline steps reach `test_errors`.
 */

import { DataStore } from "@vitest-agent/engine";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { McpHarness } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

interface CallToolResult {
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
}

const PROJECT = "traced-proj";

const seed: Effect.Effect<void, never, DataStore> = Effect.gen(function* () {
	const store = yield* DataStore;
	yield* store.writeSettings("h", { vitestVersion: "5.1.1" }, {});
	const runId = yield* store.writeRun({
		invocationId: "i1",
		project: PROJECT,
		settingsHash: "h",
		timestamp: "2026-03-01T00:00:00.000Z",
		commitSha: null,
		branch: null,
		reason: "failed",
		duration: 1,
		total: 2,
		passed: 1,
		failed: 1,
		skipped: 0,
		scoped: false,
	});
	const fileId = yield* store.ensureFile("src/a.test.ts");
	const [moduleId] = yield* store.writeModules(runId, [{ fileId, relativeModuleId: "src/a.test.ts", state: "failed" }]);
	const [failedId] = yield* store.writeTestCases(moduleId, [{ name: "traced", fullName: "traced", state: "failed" }]);
	yield* store.writeTraceSteps(failedId, null, [
		{ name: "click", status: "fail", startTime: 12, duration: 3, depth: 0, locator: "button" },
		{ name: "mark", startTime: 20, depth: 1, location: { file: "src/a.test.ts", line: 4, column: 7 } },
	]);
	yield* store.writeErrors(runId, [
		{ testCaseId: failedId, scope: "test", message: "boom", name: "AssertionError" },
		{ scope: "unhandled", message: "stray", name: "Error" },
	]);
}).pipe(Effect.orDie);

const withHarness = <A>(f: (harness: McpHarness) => Effect.Effect<A>): Promise<A> =>
	Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness({ seed }), f)));

describe("trace steps on test_errors (issue 737)", () => {
	it("should serve the failed test's recorded steps on its error and an empty list elsewhere", async () => {
		const result = (await withHarness((h) =>
			h.initialize().pipe(Effect.andThen(h.callTool("test_errors", { project: PROJECT }))),
		)) as CallToolResult;
		expect(result.isError).toBe(false);
		const errors = result.structuredContent?.errors as Array<{ message: string; traceSteps: unknown }>;
		expect(errors.find((e) => e.message === "boom")?.traceSteps).toEqual([
			{ name: "click", status: "fail", startTime: 12, duration: 3, depth: 0, locator: "button" },
			{ name: "mark", startTime: 20, depth: 1, location: { file: "src/a.test.ts", line: 4, column: 7 } },
		]);
		expect(errors.find((e) => e.message === "stray")?.traceSteps).toEqual([]);
	});
});

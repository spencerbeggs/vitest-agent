/**
 * Issue 578: the persisted stray output reaches the three query tools over
 * the in-process stdio harness — `test_status` (the latest run's value on
 * each project entry), `test_history` (how many recent runs leaked), and
 * `triage_brief` (one line in the Recent Test Runs section).
 */

import { DataStore } from "@vitest-agent/engine";
import type { StrayOutput } from "@vitest-agent/sdk";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { HarnessOptions, McpHarness } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

interface CallToolResult {
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

const STRAY: StrayOutput = {
	total: 2,
	stdout: 1,
	stderr: 1,
	bytes: 31,
	samples: [{ stream: "stdout", text: "git: warning" }],
};

const PROJECT = "leaky";

/** Two runs of `leaky` (the newest leaked) and one clean run of `quiet`. */
const seed: Effect.Effect<void, never, DataStore> = Effect.gen(function* () {
	const store = yield* DataStore;
	yield* store.writeSettings("h", { vitestVersion: "5.0.0" }, {});
	const base = {
		settingsHash: "h",
		commitSha: null,
		branch: null,
		reason: "passed" as const,
		duration: 1,
		total: 1,
		passed: 1,
		failed: 0,
		skipped: 0,
		scoped: false,
	};
	yield* store.writeRun({ ...base, invocationId: "i1", project: PROJECT, timestamp: "2026-03-01T00:00:00.000Z" });
	yield* store.writeRun({
		...base,
		invocationId: "i2",
		project: PROJECT,
		timestamp: "2026-03-02T00:00:00.000Z",
		strayOutput: STRAY,
	});
	yield* store.writeRun({ ...base, invocationId: "i3", project: "quiet", timestamp: "2026-03-03T00:00:00.000Z" });
}).pipe(Effect.orDie);

const SEEDED: HarnessOptions = { seed };

const withHarness = <A>(f: (harness: McpHarness) => Effect.Effect<A>, options?: HarnessOptions): Promise<A> =>
	Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness(options), f)));

const call = (name: string, args: unknown, options: HarnessOptions = SEEDED): Promise<CallToolResult> =>
	withHarness((h) => h.initialize().pipe(Effect.andThen(h.callTool(name, args))), options) as Promise<CallToolResult>;

describe("stray output on the query tools (issue 578)", () => {
	it("test_status carries the latest run's strayOutput only on the project that leaked", async () => {
		const result = await call("test_status", {});
		expect(result.isError).toBe(false);
		const entries = result.structuredContent?.entries as Array<{ project: string; strayOutput?: StrayOutput }>;
		const leaky = entries.find((e) => e.project === PROJECT);
		const quiet = entries.find((e) => e.project === "quiet");
		expect(leaky?.strayOutput).toEqual(STRAY);
		expect(quiet).toBeDefined();
		expect(quiet).not.toHaveProperty("strayOutput");
	});

	it("test_history reports how many recent runs of the project leaked", async () => {
		const result = await call("test_history", { project: PROJECT });
		expect(result.isError).toBe(false);
		expect(result.structuredContent?.strayOutput).toEqual({ runs: 2, runsWithStrayOutput: 1, latest: STRAY });

		const quiet = await call("test_history", { project: "quiet" });
		expect(quiet.structuredContent?.strayOutput).toEqual({ runs: 1, runsWithStrayOutput: 0, latest: null });
	});

	it("triage_brief names the leaking share of recent runs, and stays silent on a clean database", async () => {
		// Unscoped: the newest run (quiet, i3) recorded nothing, so no "latest" detail.
		const result = await call("triage_brief", {});
		expect(result.structuredContent?.hasContent).toBe(true);
		expect(result.structuredContent?.markdown).toContain(
			"- Stray output in 1 of the last 3 runs — tests or child processes writing straight to the terminal",
		);

		// Scoped to the leaking project: its newest run leaked, so the line shows it.
		const leaky = await call("triage_brief", { project: PROJECT });
		expect(leaky.structuredContent?.markdown).toContain(
			"- Stray output in 1 of the last 2 runs (latest: 2 lines, 31 bytes; first: `git: warning`)",
		);

		const quiet = await call("triage_brief", { project: "quiet" });
		expect(quiet.structuredContent?.markdown).not.toContain("Stray output");
	});
});

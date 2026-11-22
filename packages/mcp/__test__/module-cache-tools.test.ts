/**
 * Issue 741: the persisted module cache stat reaches the query tools over the
 * in-process stdio harness: `test_status` (the latest run's stat on each
 * project entry), `test_history` (the recent runs' stats, newest first, so a
 * cold run reads against a warm one) and `triage_brief` (one line under the
 * project).
 */

import { DataStore } from "@vitest-agent/engine";
import type { ModuleCacheStat } from "@vitest-agent/sdk";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { HarnessOptions, McpHarness } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

interface CallToolResult {
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

const COLD: ModuleCacheStat = { enabled: true, transformMs: 4000, trackedMs: 10000, share: 0.4, modulesWritten: 120 };
const WARM: ModuleCacheStat = { enabled: true, transformMs: 300, trackedMs: 6000, share: 0.05, modulesWritten: 0 };

const PROJECT = "cached";

/** A cold then a warm run of `cached`, and one run of `plain` with no stat. */
const seed: Effect.Effect<void, never, DataStore> = Effect.gen(function* () {
	const store = yield* DataStore;
	yield* store.writeSettings("h", { vitestVersion: "5.1.1" }, {});
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
	yield* store.writeRun({
		...base,
		invocationId: "i1",
		project: PROJECT,
		timestamp: "2026-03-01T00:00:00.000Z",
		moduleCache: COLD,
	});
	yield* store.writeRun({
		...base,
		invocationId: "i2",
		project: PROJECT,
		timestamp: "2026-03-02T00:00:00.000Z",
		moduleCache: WARM,
	});
	yield* store.writeRun({ ...base, invocationId: "i3", project: "plain", timestamp: "2026-03-03T00:00:00.000Z" });
}).pipe(Effect.orDie);

const SEEDED: HarnessOptions = { seed };

const withHarness = <A>(f: (harness: McpHarness) => Effect.Effect<A>, options?: HarnessOptions): Promise<A> =>
	Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness(options), f)));

const call = (name: string, args: unknown): Promise<CallToolResult> =>
	withHarness((h) => h.initialize().pipe(Effect.andThen(h.callTool(name, args))), SEEDED) as Promise<CallToolResult>;

describe("module cache on the query tools (issue 741)", () => {
	it("test_status carries the latest run's stat only on the project that recorded one", async () => {
		const result = await call("test_status", {});
		expect(result.isError).toBe(false);
		const entries = result.structuredContent?.entries as Array<{ project: string; moduleCache?: ModuleCacheStat }>;
		expect(entries.find((e) => e.project === PROJECT)?.moduleCache).toEqual(WARM);
		const plain = entries.find((e) => e.project === "plain");
		expect(plain).toBeDefined();
		expect(plain).not.toHaveProperty("moduleCache");
	});

	it("test_history lists the project's recorded stats newest first", async () => {
		const result = await call("test_history", { project: PROJECT });
		expect(result.isError).toBe(false);
		expect(result.structuredContent?.moduleCache).toEqual({
			runs: [
				{ timestamp: "2026-03-02T00:00:00.000Z", moduleCache: WARM },
				{ timestamp: "2026-03-01T00:00:00.000Z", moduleCache: COLD },
			],
		});
		const plain = await call("test_history", { project: "plain" });
		expect(plain.structuredContent?.moduleCache).toEqual({ runs: [] });
	});

	it("triage_brief shows the latest stat against the previous run", async () => {
		const result = await call("triage_brief", {});
		expect(result.structuredContent?.markdown).toContain(
			"  - Module cache: on · transform 300ms (5%) · 0 modules written (previous run: on · transform 4s (40%) · 120 modules written)",
		);
	});
});

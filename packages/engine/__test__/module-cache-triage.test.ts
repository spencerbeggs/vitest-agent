// Issue 741: the triage brief shows each project's module cache across its
// recent runs, so a cold run reads against a warm one.

import type { ModuleCacheStat } from "@vitest-agent/sdk";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { formatTriageEffect } from "../src/lib/format-triage.js";
import type { DataReader } from "../src/services/DataReader.js";
import type { TestRunInput } from "../src/services/DataStore.js";
import { DataStore } from "../src/services/DataStore.js";
import { makeTestLayer } from "../src/testing/layers.js";

const run = <A, E>(effect: Effect.Effect<A, E, DataStore | DataReader>) =>
	Effect.runPromise(Effect.provide(effect, makeTestLayer(":memory:")));

const COLD: ModuleCacheStat = { enabled: true, transformMs: 4000, trackedMs: 10000, share: 0.4, modulesWritten: 120 };
const WARM: ModuleCacheStat = { enabled: true, transformMs: 300, trackedMs: 6000, share: 0.05, modulesWritten: 0 };

const runInput = (
	invocationId: string,
	timestamp: string,
	moduleCache?: ModuleCacheStat,
	project = "app",
): TestRunInput => ({
	invocationId,
	timestamp,
	project,
	settingsHash: "h",
	commitSha: null,
	branch: null,
	reason: "passed",
	duration: 1,
	total: 1,
	passed: 1,
	failed: 0,
	skipped: 0,
	scoped: false,
	...(moduleCache !== undefined && { moduleCache }),
});

const triage = (runs: ReadonlyArray<TestRunInput>) =>
	run(
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("h", { vitestVersion: "5.1.1" }, {});
			for (const input of runs) yield* store.writeRun(input);
			return yield* formatTriageEffect();
		}),
	);

describe("triage module cache line", () => {
	it("shows the latest stat against the previous run under the project", async () => {
		const out = await triage([
			runInput("i1", "2026-01-01T00:00:00.000Z", COLD),
			runInput("i2", "2026-01-02T00:00:00.000Z", WARM),
		]);
		expect(out).toContain(
			"  - Module cache: on · transform 300ms (5%) · 0 modules written (previous run: on · transform 4s (40%) · 120 modules written)",
		);
	});

	it("shows just the latest stat when there is no earlier one", async () => {
		const out = await triage([runInput("i1", "2026-01-01T00:00:00.000Z", COLD)]);
		expect(out).toContain("  - Module cache: on · transform 4s (40%) · 120 modules written");
		expect(out).not.toContain("previous run");
	});

	it("leaves the line out when no run recorded a stat", async () => {
		const out = await triage([runInput("i1", "2026-01-01T00:00:00.000Z")]);
		expect(out).not.toContain("Module cache");
	});
});

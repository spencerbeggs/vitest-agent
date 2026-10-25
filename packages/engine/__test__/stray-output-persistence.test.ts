// Issue 578: a run's stray output (bytes and lines written straight to the
// terminal past Vitest's console capture) persists on its `test_runs` row and
// reads back through `DataReader`, so triage and history can see a suite
// that keeps leaking.

import type { StrayOutput } from "@vitest-agent/sdk";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { formatStrayOutputLine, formatTriageEffect } from "../src/lib/format-triage.js";
import { DataReader } from "../src/services/DataReader.js";
import type { TestRunInput } from "../src/services/DataStore.js";
import { DataStore } from "../src/services/DataStore.js";
import { makeTestLayer } from "../src/testing/layers.js";

const run = <A, E>(effect: Effect.Effect<A, E, DataStore | DataReader | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, makeTestLayer(":memory:")));

const STRAY: StrayOutput = {
	total: 3,
	stdout: 2,
	stderr: 1,
	bytes: 42,
	samples: [
		{ stream: "stdout", text: "hello from a child" },
		{ stream: "stderr", text: "warning: inherited stdio" },
	],
};

const runInput = (
	overrides: Partial<TestRunInput> & Pick<TestRunInput, "invocationId" | "timestamp">,
): TestRunInput => ({
	project: "app",
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
	...overrides,
});

const seedSettings = Effect.gen(function* () {
	const store = yield* DataStore;
	yield* store.writeSettings("h", { vitestVersion: "5.0.0" }, {});
	return store;
});

describe("stray output persistence", () => {
	it("round-trips a run's stray output through getRunsByProject and getLatestRun", async () => {
		const { summary, report } = await run(
			Effect.gen(function* () {
				const store = yield* seedSettings;
				const reader = yield* DataReader;
				yield* store.writeRun(
					runInput({ invocationId: "i1", timestamp: "2026-01-01T00:00:00.000Z", strayOutput: STRAY }),
				);
				const summaries = yield* reader.getRunsByProject();
				const latest = yield* reader.getLatestRun("app");
				return { summary: summaries.find((s) => s.project === "app"), report: Option.getOrThrow(latest) };
			}),
		);
		expect(summary?.strayOutput).toEqual(STRAY);
		expect(report.strayOutput).toEqual(STRAY);
	});

	it("stores a run that recorded nothing as NULL columns and reads it back as null / absent", async () => {
		const { columns, summary, report } = await run(
			Effect.gen(function* () {
				const store = yield* seedSettings;
				const reader = yield* DataReader;
				const sql = yield* SqlClient;
				yield* store.writeRun(runInput({ invocationId: "i1", timestamp: "2026-01-01T00:00:00.000Z" }));
				const columns = yield* sql<{
					stray_total: number | null;
					stray_bytes: number | null;
					stray_samples: string | null;
				}>`SELECT stray_total, stray_bytes, stray_samples FROM test_runs`;
				const summaries = yield* reader.getRunsByProject();
				const latest = yield* reader.getLatestRun("app");
				return { columns, summary: summaries[0], report: Option.getOrThrow(latest) };
			}),
		);
		expect(columns).toEqual([{ stray_total: null, stray_bytes: null, stray_samples: null }]);
		expect(summary?.strayOutput).toBeNull();
		expect(report).not.toHaveProperty("strayOutput");
	});

	it("reads a run with stray output but no samples as an empty samples array", async () => {
		const summary = await run(
			Effect.gen(function* () {
				const store = yield* seedSettings;
				const reader = yield* DataReader;
				yield* store.writeRun(
					runInput({
						invocationId: "i1",
						timestamp: "2026-01-01T00:00:00.000Z",
						strayOutput: { total: 0, stdout: 0, stderr: 0, bytes: 7, samples: [] },
					}),
				);
				return (yield* reader.getRunsByProject())[0];
			}),
		);
		expect(summary?.strayOutput).toEqual({ total: 0, stdout: 0, stderr: 0, bytes: 7, samples: [] });
	});

	it("tolerates an undecodable samples column instead of failing the row", async () => {
		const summary = await run(
			Effect.gen(function* () {
				const store = yield* seedSettings;
				const reader = yield* DataReader;
				const sql = yield* SqlClient;
				yield* store.writeRun(
					runInput({ invocationId: "i1", timestamp: "2026-01-01T00:00:00.000Z", strayOutput: STRAY }),
				);
				yield* sql`UPDATE test_runs SET stray_samples = '{not json'`;
				return (yield* reader.getRunsByProject())[0];
			}),
		);
		expect(summary?.strayOutput).toEqual({ ...STRAY, samples: [] });
	});

	describe("getStrayOutputHistory", () => {
		it("counts an invocation once even when several project rows carry the same stray output", async () => {
			const { all, scoped, other } = await run(
				Effect.gen(function* () {
					const store = yield* seedSettings;
					const reader = yield* DataReader;
					// Invocation 1: two projects, both carrying the same stray output.
					yield* store.writeRun(
						runInput({ invocationId: "i1", timestamp: "2026-01-01T00:00:00.000Z", strayOutput: STRAY }),
					);
					yield* store.writeRun(
						runInput({ invocationId: "i1", timestamp: "2026-01-01T00:00:00.000Z", project: "lib", strayOutput: STRAY }),
					);
					// Invocation 2: clean.
					yield* store.writeRun(runInput({ invocationId: "i2", timestamp: "2026-01-02T00:00:00.000Z" }));
					// Invocation 3: only `lib` ran, and it leaked.
					const latestStray = { ...STRAY, total: 1, stdout: 1, stderr: 0, bytes: 5 };
					yield* store.writeRun(
						runInput({
							invocationId: "i3",
							timestamp: "2026-01-03T00:00:00.000Z",
							project: "lib",
							strayOutput: latestStray,
						}),
					);
					return {
						all: yield* reader.getStrayOutputHistory(),
						scoped: yield* reader.getStrayOutputHistory({ project: "app" }),
						other: yield* reader.getStrayOutputHistory({ project: "lib", limit: 1 }),
					};
				}),
			);
			expect(all.runs).toBe(3);
			expect(all.runsWithStrayOutput).toBe(2);
			expect(all.latest?.total).toBe(1);
			// `app` ran in i1 (leaked) and i2 (clean): the most recent is clean.
			expect(scoped).toEqual({ runs: 2, runsWithStrayOutput: 1, latest: null });
			// A limit of 1 looks at i3 only.
			expect(other.runs).toBe(1);
			expect(other.runsWithStrayOutput).toBe(1);
			expect(other.latest?.bytes).toBe(5);
		});

		it("reports zero runs on an empty database", async () => {
			const history = await run(Effect.flatMap(DataReader, (reader) => reader.getStrayOutputHistory()));
			expect(history).toEqual({ runs: 0, runsWithStrayOutput: 0, latest: null });
		});
	});

	describe("triage line", () => {
		it("formatStrayOutputLine is absent when no recent run leaked", () => {
			expect(formatStrayOutputLine({ runs: 5, runsWithStrayOutput: 0, latest: null })).toBeUndefined();
		});

		it("formatStrayOutputLine names the share and the latest run's first sample", () => {
			expect(formatStrayOutputLine({ runs: 10, runsWithStrayOutput: 3, latest: STRAY })).toBe(
				"- Stray output in 3 of the last 10 runs (latest: 3 lines, 42 bytes; first: `hello from a child`) — tests or child processes writing straight to the terminal",
			);
			expect(formatStrayOutputLine({ runs: 1, runsWithStrayOutput: 1, latest: null })).toBe(
				"- Stray output in 1 of the last 1 run — tests or child processes writing straight to the terminal",
			);
		});

		it("formatTriageEffect carries the line only when a recent run leaked", async () => {
			const { clean, leaking } = await run(
				Effect.gen(function* () {
					const store = yield* seedSettings;
					yield* store.writeRun(runInput({ invocationId: "i1", timestamp: "2026-01-01T00:00:00.000Z" }));
					const clean = yield* formatTriageEffect();
					yield* store.writeRun(
						runInput({ invocationId: "i2", timestamp: "2026-01-02T00:00:00.000Z", strayOutput: STRAY }),
					);
					const leaking = yield* formatTriageEffect();
					return { clean, leaking };
				}),
			);
			expect(clean).not.toContain("Stray output");
			expect(leaking).toContain(
				"- Stray output in 1 of the last 2 runs (latest: 3 lines, 42 bytes; first: `hello from a child`)",
			);
		});
	});
});

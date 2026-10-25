/**
 * Issue #622: the reporter writes `file_coverage` rows ONCE per invocation,
 * under one run of the invocation, while every project in the run gets its
 * own `test_runs` row (and its own `coverage_trends` row). The reader must
 * therefore resolve a project run's per-file coverage through the sibling
 * run in the same `invocation_id` that carries the rows — and keep answering
 * correctly for databases older versions wrote, where every run of the
 * invocation carries an identical copy.
 */

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer, Option } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataReaderLive } from "../src/layers/DataReaderLive.js";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import migration0001 from "../src/migrations/0001_initial.js";
import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeServices.layer;

const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({ "0001_initial": migration0001 }),
}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

const TestLayer = Layer.mergeAll(
	DataStoreLive.pipe(Layer.provide(SqliteLayer)),
	DataReaderLive.pipe(Layer.provide(SqliteLayer)),
	MigratorLayer,
	SqliteLayer,
	PlatformLayer,
);

const run = <A, E>(effect: Effect.Effect<A, E, DataStore | DataReader | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, TestLayer));

const settingsInput = {
	vitestVersion: "3.2.0",
	pool: "forks",
	environment: "node",
	testTimeout: 5000,
	hookTimeout: 10000,
	slowTestThreshold: 300,
	maxConcurrency: 5,
	maxWorkers: 4,
	isolate: true,
	bail: 0,
	globals: false,
	fileParallelism: true,
	sequenceSeed: 42,
	coverageProvider: "v8",
};

const baseRun = {
	settingsHash: "inv-hash",
	commitSha: null,
	branch: null,
	reason: "passed" as const,
	duration: 10,
	total: 1,
	passed: 1,
	failed: 0,
	skipped: 0,
	scoped: false,
};

const fileRow = (fileId: number) => ({
	fileId,
	statements: 60,
	branches: 50,
	functions: 70,
	lines: 65,
	uncoveredLines: "1-3",
	tier: "below_threshold" as const,
});

const trend = (timestamp: string) => ({
	timestamp,
	coverage: { lines: 65, branches: 50, functions: 70, statements: 60 },
	delta: { lines: 0, branches: 0, functions: 0, statements: 0 },
	direction: "stable" as const,
});

/** Two projects in one invocation; only the FIRST project's run carries rows. */
const seedOncePerInvocation = Effect.gen(function* () {
	const store = yield* DataStore;
	yield* store.writeSettings("inv-hash", settingsInput, {});
	const ts = "2026-04-01T00:00:00.000Z";
	const alpha = yield* store.writeRun({ ...baseRun, invocationId: "inv-622", project: "alpha", timestamp: ts });
	const beta = yield* store.writeRun({ ...baseRun, invocationId: "inv-622", project: "beta", timestamp: ts });
	const fileId = yield* store.ensureFile("src/shared.ts");
	yield* store.writeCoverage(alpha, [fileRow(fileId)]);
	yield* store.writeTrends("alpha", alpha, trend(ts));
	yield* store.writeTrends("beta", beta, trend(ts));
	return { alpha, beta, fileId };
});

describe("DataReaderLive resolves per-file coverage through the invocation (#622)", () => {
	it("getCoverage(project) finds the rows a sibling run of the same invocation carries", async () => {
		const result = await run(
			Effect.gen(function* () {
				yield* seedOncePerInvocation;
				const reader = yield* DataReader;
				return yield* reader.getCoverage("beta");
			}),
		);
		expect(Option.isSome(result)).toBe(true);
		const coverage = Option.getOrThrow(result);
		expect(coverage.lowCoverageFiles).toEqual(["src/shared.ts"]);
		expect(coverage.lowCoverage[0].uncoveredLines).toBe("1-3");
		// Totals still come from the project's OWN trend row.
		expect(coverage.totals.lines).toBeCloseTo(65);
	});

	it("getLatestRun(project) attaches lowCoverage from the invocation's carrier run", async () => {
		const result = await run(
			Effect.gen(function* () {
				yield* seedOncePerInvocation;
				const reader = yield* DataReader;
				return yield* reader.getLatestRun("beta");
			}),
		);
		const report = Option.getOrThrow(result);
		expect(report.coverage?.lowCoverageFiles).toEqual(["src/shared.ts"]);
		expect(report.coverage?.totals.lines).toBeCloseTo(65);
	});

	it("getFileCoverage(runId) resolves a run without rows to its invocation's carrier", async () => {
		const rows = await run(
			Effect.gen(function* () {
				const { beta } = yield* seedOncePerInvocation;
				const reader = yield* DataReader;
				return yield* reader.getFileCoverage(beta);
			}),
		);
		expect(rows.map((r) => r.file)).toEqual(["src/shared.ts"]);
	});

	it("legacy layout (rows under EVERY run of the invocation) still returns one copy", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSettings("inv-hash", settingsInput, {});
				const ts = "2026-04-02T00:00:00.000Z";
				const alpha = yield* store.writeRun({
					...baseRun,
					invocationId: "inv-legacy",
					project: "alpha",
					timestamp: ts,
				});
				const beta = yield* store.writeRun({ ...baseRun, invocationId: "inv-legacy", project: "beta", timestamp: ts });
				const fileId = yield* store.ensureFile("src/legacy.ts");
				// An older reporter wrote the same map under both runs.
				yield* store.writeCoverage(alpha, [fileRow(fileId)]);
				yield* store.writeCoverage(beta, [fileRow(fileId)]);
				yield* store.writeTrends("alpha", alpha, trend(ts));
				yield* store.writeTrends("beta", beta, trend(ts));
				const reader = yield* DataReader;
				return yield* reader.getCoverage("beta");
			}),
		);
		const coverage = Option.getOrThrow(result);
		expect(coverage.lowCoverage).toHaveLength(1);
		expect(coverage.lowCoverageFiles).toEqual(["src/legacy.ts"]);
	});

	it("never borrows rows from a different invocation", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* seedOncePerInvocation;
				// A later, separate invocation for beta that wrote no coverage rows
				// and no trend (e.g. coverage disabled). Its latest run must not
				// inherit inv-622's rows.
				yield* store.writeRun({
					...baseRun,
					invocationId: "inv-later",
					project: "beta",
					timestamp: "2026-04-03T00:00:00.000Z",
				});
				const reader = yield* DataReader;
				return yield* reader.getLatestRun("beta");
			}),
		);
		const report = Option.getOrThrow(result);
		expect(report.coverage?.lowCoverage ?? []).toHaveLength(0);
	});
});

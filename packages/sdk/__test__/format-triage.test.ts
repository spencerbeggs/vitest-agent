import * as NodeContext from "@effect/platform-node/NodeContext";
import type { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { DataStoreError } from "../src/errors/DataStoreError.js";
import { DataReaderLive } from "../src/layers/DataReaderLive.js";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import { formatTriageEffect } from "../src/lib/format-triage.js";
import migration0001 from "../src/migrations/0001_initial.js";
import migration0002 from "../src/migrations/0002_comprehensive.js";
import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeContext.layer;

const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({
		"0001_initial": migration0001,
		"0002_comprehensive": migration0002,
	}),
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

// Canonical seed data matching DataStore's actual interfaces
const settingsHash = "triage-test-hash";
const settingsInput = {
	vitest_version: "3.2.0",
	pool: "forks",
	environment: "node",
	test_timeout: 5000,
	hook_timeout: 10000,
	slow_test_threshold: 300,
	max_concurrency: 5,
	max_workers: 4,
	isolate: true,
	bail: 0,
	globals: false,
	file_parallelism: true,
	sequence_seed: 42,
	coverage_provider: "v8",
};

const runInput = {
	invocationId: "inv-triage-001",
	project: "my-project",
	subProject: null,
	settingsHash,
	timestamp: "2026-04-30T10:00:00.000Z",
	commitSha: "abc1234",
	branch: "main",
	reason: "failed" as const,
	duration: 2500,
	total: 5,
	passed: 3,
	failed: 2,
	skipped: 0,
	scoped: false,
};

describe("formatTriageEffect", () => {
	it("returns a non-empty markdown string containing the project name", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSettings(settingsHash, settingsInput, {});
				yield* store.writeRun(runInput);
				return yield* formatTriageEffect();
			}),
		);
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
		expect(result).toContain("my-project");
	});

	it("returns a string with no DataStoreError when the database is empty", async () => {
		// formatTriageEffect must have E = never (all errors swallowed)
		const result = await Effect.runPromise(Effect.provide(formatTriageEffect(), TestLayer));
		expect(typeof result).toBe("string");
	});

	it("includes session info when a session exists", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSession({
					cc_session_id: "cc-test-session-001",
					project: "my-project",
					cwd: "/workspace/my-project",
					agent_kind: "main",
					started_at: "2026-04-30T09:00:00.000Z",
				});
				return yield* formatTriageEffect();
			}),
		);
		expect(typeof result).toBe("string");
		expect(result).toContain("session");
	});

	it("respects maxLines by truncating long sections", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSettings(settingsHash, settingsInput, {});
				yield* store.writeRun(runInput);
				yield* store.writeRun({
					...runInput,
					invocationId: "inv-triage-002",
					project: "another",
				});
				yield* store.writeRun({
					...runInput,
					invocationId: "inv-triage-003",
					project: "third",
				});
				return yield* formatTriageEffect({ maxLines: 5 });
			}),
		);
		expect(result.split("\n").length).toBeLessThanOrEqual(5);
	});

	it("filters runs to only the named project when options.project is set", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSettings(settingsHash, settingsInput, {});
				yield* store.writeRun(runInput);
				yield* store.writeRun({
					...runInput,
					invocationId: "inv-triage-keep",
					project: "keep-me",
				});
				yield* store.writeRun({
					...runInput,
					invocationId: "inv-triage-drop",
					project: "drop-me",
				});
				return yield* formatTriageEffect({ project: "keep-me" });
			}),
		);
		expect(result).toContain("keep-me");
		expect(result).not.toContain("drop-me");
		expect(result).not.toContain("my-project");
	});

	it("matches a sub-projected run when options.project is 'project:subProject'", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSettings(settingsHash, settingsInput, {});
				yield* store.writeRun({
					...runInput,
					invocationId: "inv-triage-sub",
					project: "mono",
					subProject: "unit",
				});
				yield* store.writeRun({
					...runInput,
					invocationId: "inv-triage-other",
					project: "mono",
					subProject: "e2e",
				});
				return yield* formatTriageEffect({ project: "mono:unit" });
			}),
		);
		expect(result).toContain("mono:unit");
		expect(result).not.toContain("mono:e2e");
	});

	it("swallows DataReader errors and still returns a string with default fallbacks", async () => {
		// Construct a DataReader test layer where every method called by
		// formatTriageEffect fails, exercising all four `Effect.orElseSucceed`
		// arrow-function fallbacks (lines 21, 30, 39, 42 of format-triage.ts).
		const failingReader = DataReader.of({
			getRunsByProject: () =>
				Effect.fail(new DataStoreError({ operation: "read", table: "test_runs", reason: "boom" })),
			listSessions: () => Effect.fail(new DataStoreError({ operation: "read", table: "sessions", reason: "boom" })),
			computeAcceptanceMetrics: () =>
				Effect.fail(new DataStoreError({ operation: "read", table: "tdd_artifacts", reason: "boom" })),
			getTddSessionById: () =>
				Effect.fail(new DataStoreError({ operation: "read", table: "tdd_sessions", reason: "boom" })),
			// Unused methods can be left as `null as never` since formatTriageEffect
			// never reaches them.
		} as unknown as DataReader["Type"]);
		const FailingReaderLayer = Layer.succeed(DataReader, failingReader);

		const result = await Effect.runPromise(Effect.provide(formatTriageEffect(), FailingReaderLayer));
		expect(typeof result).toBe("string");
		expect(result).toContain("## Vitest Agent Reporter");
		// Empty fallback paths are taken: no test runs, no sessions, no open TDD section.
		expect(result).toContain("_No test runs recorded yet._");
		expect(result).toContain("_No session data recorded yet._");
		expect(result).not.toContain("### Open TDD Session");
		// All four metric ratios fall back to 0% (the fallbackMetrics object).
		expect(result).toContain("Phase evidence integrity: 0%");
	});

	it("renders an Open TDD Session section when a TDD session exists with id 1", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sessionId = yield* store.writeSession({
					cc_session_id: "cc-tdd-session",
					project: "tdd-project",
					cwd: "/workspace/tdd-project",
					agent_kind: "main",
					started_at: "2026-04-30T11:00:00.000Z",
				});
				yield* store.writeTddSession({
					sessionId,
					goal: "make the orientation triage report support TDD session display",
					startedAt: "2026-04-30T11:30:00.000Z",
				});
				return yield* formatTriageEffect();
			}),
		);
		expect(result).toContain("### Open TDD Session");
		expect(result).toContain("make the orientation triage report support TDD session display");
		expect(result).toContain("Started: 2026-04-30T11:30:00.000Z");
		expect(result).toContain("Phases recorded:");
	});
});

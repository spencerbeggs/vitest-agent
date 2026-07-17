import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataStoreError } from "../src/errors/DataStoreError.js";
import { DataReaderLive } from "../src/layers/DataReaderLive.js";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import { formatTriageEffect } from "../src/lib/format-triage.js";
import migration0001 from "../src/migrations/0001_initial.js";

import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeServices.layer;

const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({
		"0001_initial": migration0001,
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

const runInput = {
	invocationId: "inv-triage-001",
	project: "my-project",
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

	it("always includes the L2 MCP-tool guidance block before the Recent Test Runs section", async () => {
		// The L2 block must land on every triage, including an empty DB, so the
		// SessionStart hook always injects the orientation surface.
		const result = await Effect.runPromise(Effect.provide(formatTriageEffect(), TestLayer));
		expect(result).toContain("### Available vitest-agent MCP tools (most useful)");
		expect(result).toContain("- `run_tests` —");
		expect(result).toContain("- `test_errors` —");
		expect(result).toContain("- `test_history` —");
		expect(result).toContain("- `file_coverage` —");
		expect(result).toContain("- `triage_brief` —");
		expect(result.indexOf("### Available vitest-agent MCP tools")).toBeLessThan(result.indexOf("### Recent Test Runs"));
	});

	it("includes session info when a session exists", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSession({
					chatId: "cc-test-session-001",
					project: "my-project",
					cwd: "/workspace/my-project",
					agentKind: "main",
					startedAt: "2026-04-30T09:00:00.000Z",
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
			getTddTaskById: () => Effect.fail(new DataStoreError({ operation: "read", table: "tdd_tasks", reason: "boom" })),
			// Unused methods can be left as `null as never` since formatTriageEffect
			// never reaches them.
		} as unknown as DataReader["Service"]);
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
					chatId: "cc-tdd-session",
					project: "tdd-project",
					cwd: "/workspace/tdd-project",
					agentKind: "main",
					startedAt: "2026-04-30T11:00:00.000Z",
				});
				yield* store.writeTddTask({
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

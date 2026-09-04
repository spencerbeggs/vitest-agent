import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import type { DataReader, DataStore } from "@vitest-agent/sdk";
import { DataReaderLive, DataStoreLive, DataStore as DataStoreTag, migration0001 } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import {
	dispatchRecordTddArtifactEffect,
	recordTddArtifactByTaskIdEffect,
	recordTddArtifactEffect,
} from "../src/lib/record-tdd-artifact.js";

const PlatformLayer = NodeServices.layer;

const buildLive = () => {
	const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({
			"0001_initial": migration0001,
		}),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
	return Layer.mergeAll(
		DataStoreLive.pipe(Layer.provide(SqliteLayer)),
		DataReaderLive.pipe(Layer.provide(SqliteLayer)),
		MigratorLayer,
		SqliteLayer,
		PlatformLayer,
	);
};

const run = <A, E>(effect: Effect.Effect<A, E, DataReader | DataStore | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, buildLive()));

describe("recordTddArtifactEffect", () => {
	it("resolves the open phase via chat_id and writes a tdd_artifact row", async () => {
		const result = await run(
			Effect.gen(function* () {
				const ds = yield* DataStoreTag;
				const sessionId = yield* ds.writeSession({
					chatId: "cc-art",
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "subagent",
					agentType: "tdd-orchestrator",
					startedAt: "2026-04-29T00:00:00Z",
				});
				const tddId = yield* ds.writeTddTask({
					sessionId,
					goal: "g",
					startedAt: "2026-04-29T00:00:01Z",
				});
				yield* ds.writeTddPhase({
					tddTaskId: tddId,
					phase: "red",
					startedAt: "2026-04-29T00:00:02Z",
				});

				return yield* recordTddArtifactEffect({
					chatId: "cc-art",
					artifactKind: "test_written",
					recordedAt: "2026-04-29T00:00:03Z",
				});
			}),
		);
		expect(result.id).toBeGreaterThan(0);
		expect(result.phaseId).toBeGreaterThan(0);
	});

	it("fails loudly when the chat_id has no open TDD phase", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.provide(
				Effect.gen(function* () {
					const ds = yield* DataStoreTag;
					yield* ds.writeSession({
						chatId: "cc-no-tdd",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
					});
					return yield* recordTddArtifactEffect({
						chatId: "cc-no-tdd",
						artifactKind: "code_written",
						recordedAt: "2026-04-29T00:00:01Z",
					});
				}),
				buildLive(),
			),
		);
		expect(exit._tag).toBe("Failure");
	});

	it("fails loudly when the chat_id is unknown", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.provide(
				recordTddArtifactEffect({
					chatId: "nonexistent",
					artifactKind: "code_written",
					recordedAt: "2026-04-29T00:00:01Z",
				}),
				buildLive(),
			),
		);
		expect(exit._tag).toBe("Failure");
	});

	it("auto-opens a spike phase when the TDD session has no open phase", async () => {
		const result = await run(
			Effect.gen(function* () {
				const ds = yield* DataStoreTag;
				const sessionId = yield* ds.writeSession({
					chatId: "cc-no-phase",
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "subagent",
					agentType: "tdd-orchestrator",
					startedAt: "2026-04-29T00:00:00Z",
				});
				// TDD session with no phase yet — exercises the
				// Option.isNone(phaseOpt) branch that auto-opens
				// a spike phase.
				yield* ds.writeTddTask({
					sessionId,
					goal: "g",
					startedAt: "2026-04-29T00:00:01Z",
				});

				return yield* recordTddArtifactEffect({
					chatId: "cc-no-phase",
					artifactKind: "test_written",
					recordedAt: "2026-04-29T00:00:02Z",
				});
			}),
		);
		expect(result.id).toBeGreaterThan(0);
		expect(result.phaseId).toBeGreaterThan(0);
	});

	it("resolves the open task via conversation_id when the parent walk finds none (issue #144)", async () => {
		const result = await run(
			Effect.gen(function* () {
				const ds = yield* DataStoreTag;
				const conversationId = "66666666-6666-6666-6666-666666666666";
				const mainSessionId = yield* ds.writeSession({
					chatId: "cc-conv-main-artifact",
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "main",
					conversationId,
					startedAt: "2026-04-29T00:00:00Z",
				});
				const tddId = yield* ds.writeTddTask({
					sessionId: mainSessionId,
					goal: "g",
					startedAt: "2026-04-29T00:00:01Z",
				});
				yield* ds.writeTddPhase({
					tddTaskId: tddId,
					phase: "red",
					startedAt: "2026-04-29T00:00:02Z",
				});

				// Detached session: no parent_session_id, same conversation_id.
				yield* ds.writeSession({
					chatId: "cc-conv-detached-artifact",
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "subagent",
					conversationId,
					startedAt: "2026-04-29T00:00:03Z",
				});

				return yield* recordTddArtifactEffect({
					chatId: "cc-conv-detached-artifact",
					artifactKind: "test_written",
					recordedAt: "2026-04-29T00:00:04Z",
				});
			}),
		);
		expect(result.id).toBeGreaterThan(0);
		expect(result.phaseId).toBeGreaterThan(0);
	});

	it("forwards all optional FK fields when provided", async () => {
		const result = await run(
			Effect.gen(function* () {
				const ds = yield* DataStoreTag;
				const sessionId = yield* ds.writeSession({
					chatId: "cc-all-fks",
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "subagent",
					agentType: "tdd-orchestrator",
					startedAt: "2026-04-29T00:00:00Z",
				});
				const tddId = yield* ds.writeTddTask({
					sessionId,
					goal: "g",
					startedAt: "2026-04-29T00:00:01Z",
				});
				yield* ds.writeTddPhase({
					tddTaskId: tddId,
					phase: "red",
					startedAt: "2026-04-29T00:00:02Z",
				});

				// Set up real FK targets so the optional field
				// inserts don't fail FK constraints.
				const fileId = yield* ds.ensureFile("/abs/path/to/file.ts");
				const moduleFileId = yield* ds.ensureFile("/abs/path/to/file.test.ts");
				yield* ds.writeSettings(
					"hash-1",
					{
						vitestVersion: "4.1.5",
					},
					{},
				);
				const runId = yield* ds.writeRun({
					invocationId: "inv-1",
					project: "demo",
					settingsHash: "hash-1",
					timestamp: "2026-04-29T00:00:03Z",
					commitSha: null,
					branch: null,
					reason: "passed",
					duration: 10,
					total: 1,
					passed: 1,
					failed: 0,
					skipped: 0,
					scoped: false,
				});
				const moduleIds = yield* ds.writeModules(runId, [
					{
						fileId: moduleFileId,
						relativeModuleId: "file.test.ts",
						state: "passed",
						duration: 5,
					},
				]);
				const testCaseIds = yield* ds.writeTestCases(moduleIds[0]!, [
					{
						name: "case",
						fullName: "case",
						state: "passed",
					},
				]);

				return yield* recordTddArtifactEffect({
					chatId: "cc-all-fks",
					artifactKind: "test_failed_run",
					fileId,
					testCaseId: testCaseIds[0]!,
					testRunId: runId,
					testFirstFailureRunId: runId,
					diffExcerpt: "- a\n+ b",
					recordedAt: "2026-04-29T00:00:04Z",
				});
			}),
		);
		expect(result.id).toBeGreaterThan(0);
		expect(result.phaseId).toBeGreaterThan(0);
	});
});

describe("recordTddArtifactByTaskIdEffect (issue #144 escape hatch)", () => {
	it("writes an artifact under the given task's current open phase, bypassing session resolution entirely", async () => {
		const result = await run(
			Effect.gen(function* () {
				const ds = yield* DataStoreTag;
				const sessionId = yield* ds.writeSession({
					chatId: "cc-task-id-hatch",
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "subagent",
					startedAt: "2026-04-29T00:00:00Z",
				});
				const tddId = yield* ds.writeTddTask({
					sessionId,
					goal: "g",
					startedAt: "2026-04-29T00:00:01Z",
				});
				yield* ds.writeTddPhase({
					tddTaskId: tddId,
					phase: "red",
					startedAt: "2026-04-29T00:00:02Z",
				});

				return yield* recordTddArtifactByTaskIdEffect({
					tddTaskId: tddId,
					artifactKind: "test_written",
					recordedAt: "2026-04-29T00:00:03Z",
				});
			}),
		);
		expect(result.id).toBeGreaterThan(0);
		expect(result.phaseId).toBeGreaterThan(0);
	});

	it("fails clearly when the task does not exist", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.provide(
				recordTddArtifactByTaskIdEffect({
					tddTaskId: 999999,
					artifactKind: "code_written",
					recordedAt: "2026-04-29T00:00:01Z",
				}),
				buildLive(),
			),
		);
		expect(exit._tag).toBe("Failure");
	});

	it("fails clearly when the task is already ended", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.provide(
				Effect.gen(function* () {
					const ds = yield* DataStoreTag;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-task-id-ended",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({
						sessionId,
						goal: "g",
						startedAt: "2026-04-29T00:00:01Z",
					});
					yield* ds.endTddTask({ id: tddId, outcome: "succeeded", endedAt: "2026-04-29T00:00:02Z" });

					return yield* recordTddArtifactByTaskIdEffect({
						tddTaskId: tddId,
						artifactKind: "code_written",
						recordedAt: "2026-04-29T00:00:03Z",
					});
				}),
				buildLive(),
			),
		);
		expect(exit._tag).toBe("Failure");
	});
});

describe("dispatchRecordTddArtifactEffect (issue #144 CLI wiring)", () => {
	it("routes to recordTddArtifactByTaskIdEffect when tddTaskId is provided, ignoring chatId", async () => {
		const result = await run(
			Effect.gen(function* () {
				const ds = yield* DataStoreTag;
				const sessionId = yield* ds.writeSession({
					chatId: "cc-dispatch-task-id",
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "subagent",
					startedAt: "2026-04-29T00:00:00Z",
				});
				const tddId = yield* ds.writeTddTask({
					sessionId,
					goal: "g",
					startedAt: "2026-04-29T00:00:01Z",
				});
				yield* ds.writeTddPhase({ tddTaskId: tddId, phase: "red", startedAt: "2026-04-29T00:00:02Z" });

				return yield* dispatchRecordTddArtifactEffect({
					tddTaskId: tddId,
					artifactKind: "test_written",
					recordedAt: "2026-04-29T00:00:03Z",
				});
			}),
		);
		expect(result.id).toBeGreaterThan(0);
	});

	it("routes to recordTddArtifactEffect when only chatId is provided", async () => {
		const result = await run(
			Effect.gen(function* () {
				const ds = yield* DataStoreTag;
				const sessionId = yield* ds.writeSession({
					chatId: "cc-dispatch-chat-id",
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "subagent",
					startedAt: "2026-04-29T00:00:00Z",
				});
				const tddId = yield* ds.writeTddTask({
					sessionId,
					goal: "g",
					startedAt: "2026-04-29T00:00:01Z",
				});
				yield* ds.writeTddPhase({ tddTaskId: tddId, phase: "red", startedAt: "2026-04-29T00:00:02Z" });

				return yield* dispatchRecordTddArtifactEffect({
					chatId: "cc-dispatch-chat-id",
					artifactKind: "test_written",
					recordedAt: "2026-04-29T00:00:03Z",
				});
			}),
		);
		expect(result.id).toBeGreaterThan(0);
	});

	it("fails clearly when neither chatId nor tddTaskId is provided", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.provide(
				dispatchRecordTddArtifactEffect({
					artifactKind: "code_written",
					recordedAt: "2026-04-29T00:00:01Z",
				}),
				buildLive(),
			),
		);
		expect(exit._tag).toBe("Failure");
	});
});

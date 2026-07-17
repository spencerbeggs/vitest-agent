import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import type { DataReader, DataStore } from "@vitest-agent/sdk";
import { DataReaderLive, DataStoreLive, migration0001 } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { recordSessionStart } from "../src/lib/record-session.js";
import { parseAndValidateTurnPayload, recordTurnEffect } from "../src/lib/record-turn.js";

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

describe("parseAndValidateTurnPayload", () => {
	it("accepts a valid user_prompt payload", () => {
		const result = parseAndValidateTurnPayload(JSON.stringify({ type: "user_prompt", prompt: "hello" }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.payload.type).toBe("user_prompt");
		}
	});

	it("accepts a valid hook_fire payload", () => {
		const result = parseAndValidateTurnPayload(JSON.stringify({ type: "hook_fire", hook_kind: "PreCompact" }));
		expect(result.ok).toBe(true);
	});

	it("accepts a valid file_edit payload", () => {
		const result = parseAndValidateTurnPayload(
			JSON.stringify({ type: "file_edit", file_path: "/tmp/x.ts", edit_kind: "edit" }),
		);
		expect(result.ok).toBe(true);
	});

	it("rejects malformed JSON", () => {
		const result = parseAndValidateTurnPayload("{not json");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch(/JSON/i);
		}
	});

	it("rejects payload with unknown type discriminator", () => {
		const result = parseAndValidateTurnPayload(JSON.stringify({ type: "wat", foo: "bar" }));
		expect(result.ok).toBe(false);
	});

	it("rejects payload missing required field for its variant", () => {
		const result = parseAndValidateTurnPayload(JSON.stringify({ type: "user_prompt" /* missing prompt */ }));
		expect(result.ok).toBe(false);
	});
});

describe("recordTurnEffect", () => {
	it("writes a turn for a known session", async () => {
		const result = await run(
			Effect.gen(function* () {
				yield* recordSessionStart({
					chatId: "cc-rt-1",
					project: "p",
					cwd: "/tmp/p",
					agentKind: "main",
					startedAt: "2026-04-29T00:00:00Z",
					triageWasNonEmpty: false,
				});
				return yield* recordTurnEffect({
					chatId: "cc-rt-1",
					payloadJson: JSON.stringify({ type: "user_prompt", prompt: "hello" }),
					occurredAt: "2026-04-29T00:00:01Z",
				});
			}),
		);
		expect(result.turnId).toBeGreaterThan(0);
	});

	it("resolves to the synthetic subagent row when the bare cc id has no exact match", async () => {
		// Mirror the SubagentStart hook's synthetic-key convention:
		// `<parentCcId>-subagent-<ts>-<pid>`. PostToolUse hooks under
		// the subagent receive the bare parent cc id; the resolver
		// must fall through to the prefix match instead of bootstrapping
		// a fresh main row that would orphan the artifact.
		const result = await run(
			Effect.gen(function* () {
				yield* recordSessionStart({
					chatId: "parent-cc-id-subagent-1700000000-12345",
					project: "test-project",
					cwd: "/tmp/test-project",
					agentKind: "subagent",
					agentType: "tdd-task",
					triageWasNonEmpty: false,
					startedAt: "2026-04-29T00:00:00Z",
				});
				return yield* recordTurnEffect({
					chatId: "parent-cc-id",
					payloadJson: JSON.stringify({ type: "user_prompt", prompt: "hello" }),
					occurredAt: "2026-04-29T00:00:01Z",
					project: "test-project",
					cwd: "/tmp/test-project",
				});
			}),
		);
		expect(result.turnId).toBeGreaterThan(0);
	});

	it("bootstraps a session row when the cc id has no exact or subagent-prefix match", async () => {
		// Pre-2.0 behavior was to reject with "Unknown chat_id".
		// recordTurnEffect now self-heals via resolveSessionForRecording's
		// bootstrap path so PostToolUse hooks survive a Claude Code
		// `chat_id` rotation that misses SessionStart for the new id.
		const result = await run(
			recordTurnEffect({
				chatId: "bootstrap-cc-id",
				payloadJson: JSON.stringify({ type: "user_prompt", prompt: "hello" }),
				occurredAt: "2026-04-29T00:00:01Z",
				project: "test-project",
				cwd: "/tmp/test-project",
			}),
		);
		expect(result.turnId).toBeGreaterThan(0);
	});

	it("fails when the payload JSON is malformed", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					yield* recordSessionStart({
						chatId: "cc-rt-bad-json",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
						triageWasNonEmpty: false,
					});
					return yield* recordTurnEffect({
						chatId: "cc-rt-bad-json",
						payloadJson: "{not json",
						occurredAt: "2026-04-29T00:00:01Z",
					});
				}),
			),
		).rejects.toThrow(/Invalid JSON/i);
	});

	it("fails when the payload doesn't match TurnPayload", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					yield* recordSessionStart({
						chatId: "cc-rt-bad-shape",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
						triageWasNonEmpty: false,
					});
					return yield* recordTurnEffect({
						chatId: "cc-rt-bad-shape",
						payloadJson: JSON.stringify({ type: "user_prompt" /* missing prompt */ }),
						occurredAt: "2026-04-29T00:00:01Z",
					});
				}),
			),
		).rejects.toThrow(/Invalid TurnPayload/i);
	});
});

import * as NodeContext from "@effect/platform-node/NodeContext";
import type { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { DataReader, DataStore } from "vitest-agent-sdk";
import { DataReaderLive, DataStoreLive, migration0001, migration0002 } from "vitest-agent-sdk";
import { recordSessionStart } from "../src/lib/record-session.js";
import { parseAndValidateTurnPayload, recordTurnEffect } from "../src/lib/record-turn.js";

const PlatformLayer = NodeContext.layer;

const buildLive = () => {
	const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({
			"0001_initial": migration0001,
			"0002_comprehensive": migration0002,
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
					ccSessionId: "cc-rt-1",
					project: "p",
					cwd: "/tmp/p",
					agentKind: "main",
					startedAt: "2026-04-29T00:00:00Z",
					triageWasNonEmpty: false,
				});
				return yield* recordTurnEffect({
					ccSessionId: "cc-rt-1",
					payloadJson: JSON.stringify({ type: "user_prompt", prompt: "hello" }),
					occurredAt: "2026-04-29T00:00:01Z",
				});
			}),
		);
		expect(result.turnId).toBeGreaterThan(0);
	});

	it("fails when the session id is unknown", async () => {
		await expect(
			run(
				recordTurnEffect({
					ccSessionId: "missing",
					payloadJson: JSON.stringify({ type: "user_prompt", prompt: "hello" }),
					occurredAt: "2026-04-29T00:00:01Z",
				}),
			),
		).rejects.toThrow(/Unknown cc_session_id/);
	});

	it("fails when the payload JSON is malformed", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					yield* recordSessionStart({
						ccSessionId: "cc-rt-bad-json",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
						triageWasNonEmpty: false,
					});
					return yield* recordTurnEffect({
						ccSessionId: "cc-rt-bad-json",
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
						ccSessionId: "cc-rt-bad-shape",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
						triageWasNonEmpty: false,
					});
					return yield* recordTurnEffect({
						ccSessionId: "cc-rt-bad-shape",
						payloadJson: JSON.stringify({ type: "user_prompt" /* missing prompt */ }),
						occurredAt: "2026-04-29T00:00:01Z",
					});
				}),
			),
		).rejects.toThrow(/Invalid TurnPayload/i);
	});
});

import * as NodeContext from "@effect/platform-node/NodeContext";
import type { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import type { DataReader, DataStore } from "@vitest-agent/sdk";
import { DataReaderLive, DataStoreLive, migration0001 } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { recordSessionEnd, recordSessionStart } from "../src/lib/record-session.js";

// Each call to `run` builds a fresh in-memory DB by re-evaluating the layer.
// The :memory: connection is per-Layer so all services share it within one run.
const PlatformLayer = NodeContext.layer;

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

describe("record-session", () => {
	it("recordSessionStart inserts and returns the new session id", async () => {
		const result = await run(
			recordSessionStart({
				chatId: "cc-rs-1",
				project: "p",
				cwd: "/tmp/p",
				agentKind: "main",
				startedAt: "2026-04-29T00:00:00Z",
				triageWasNonEmpty: false,
			}),
		);
		expect(result.sessionId).toBeGreaterThan(0);
	});

	it("recordSessionEnd updates ended_at on the matching session", async () => {
		const result = await run(
			Effect.gen(function* () {
				yield* recordSessionStart({
					chatId: "cc-rs-end",
					project: "p",
					cwd: "/tmp/p",
					agentKind: "main",
					startedAt: "2026-04-29T00:00:00Z",
					triageWasNonEmpty: false,
				});
				return yield* recordSessionEnd({
					chatId: "cc-rs-end",
					endedAt: "2026-04-29T00:00:30Z",
					endReason: "clear",
				});
			}),
		);
		expect(result).toEqual({ ok: true });
	});

	it("recordSessionEnd fails on unknown session", async () => {
		await expect(
			run(
				recordSessionEnd({
					chatId: "unknown",
					endedAt: "2026-04-29T00:00:30Z",
					endReason: null,
				}),
			),
		).rejects.toThrow();
	});

	it("recordSessionStart resolves parent session when parentChatId points at an existing session", async () => {
		const result = await run(
			Effect.gen(function* () {
				const parent = yield* recordSessionStart({
					chatId: "cc-rs-parent",
					project: "p",
					cwd: "/tmp/p",
					agentKind: "main",
					startedAt: "2026-04-29T00:00:00Z",
					triageWasNonEmpty: false,
				});
				const child = yield* recordSessionStart({
					chatId: "cc-rs-child",
					project: "p",
					cwd: "/tmp/p",
					agentKind: "subagent",
					parentChatId: "cc-rs-parent",
					startedAt: "2026-04-29T00:00:01Z",
					triageWasNonEmpty: false,
				});
				return { parent, child };
			}),
		);
		expect(result.parent.sessionId).toBeGreaterThan(0);
		expect(result.child.sessionId).toBeGreaterThan(0);
		expect(result.child.sessionId).not.toBe(result.parent.sessionId);
	});

	it("recordSessionStart proceeds when parentChatId points at a missing session", async () => {
		const result = await run(
			recordSessionStart({
				chatId: "cc-rs-orphan",
				project: "p",
				cwd: "/tmp/p",
				agentKind: "subagent",
				parentChatId: "cc-rs-missing-parent",
				startedAt: "2026-04-29T00:00:00Z",
				triageWasNonEmpty: false,
			}),
		);
		expect(result.sessionId).toBeGreaterThan(0);
	});

	it("recordSessionStart accepts optional agentType field", async () => {
		const result = await run(
			recordSessionStart({
				chatId: "cc-rs-agenttype",
				project: "p",
				cwd: "/tmp/p",
				agentKind: "subagent",
				agentType: "tdd-orchestrator",
				startedAt: "2026-04-29T00:00:00Z",
				triageWasNonEmpty: true,
			}),
		);
		expect(result.sessionId).toBeGreaterThan(0);
	});
});

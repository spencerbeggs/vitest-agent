/**
 * Unit-level (no shelling out to the built bin) coverage of
 * {@link registerAgentEffect}, focused on issue #144: the registered
 * session row must end up with a populated `conversation_id`, whether
 * the session pre-existed (written by `record session-start` before
 * `register-agent` ran) or is created fresh inside `registerAgentEffect`
 * itself.
 */

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import {
	AgentContext,
	DataReader,
	DataReaderLive,
	DataStore,
	DataStoreLive,
	PerClientSessionMapWriterLive,
	RunContext,
	RunContextTest,
	migration0001,
	sessionMapMigration0001,
} from "@vitest-agent/sdk";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { registerAgentEffect } from "../src/lib/internal-register-agent.js";

const PlatformLayer = NodeServices.layer;

const buildLive = () => {
	const ProjectSqliteLayer = sqliteClientLayer({ filename: ":memory:" });
	const ProjectMigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({ "0001_initial": migration0001 }),
	}).pipe(Layer.provide(Layer.merge(ProjectSqliteLayer, PlatformLayer)));

	const SessionMapSqliteLayer = sqliteClientLayer({ filename: ":memory:" });
	const SessionMapMigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({ "0001_initial": sessionMapMigration0001 }),
	}).pipe(Layer.provide(Layer.merge(SessionMapSqliteLayer, PlatformLayer)));

	const fixtureRunContext = new RunContext({
		gitBranch: null,
		gitCommitSha: null,
		gitDirty: null,
		gitUpstream: null,
		gitWorktreeDir: null,
		hostSource: null,
		hostValue: null,
		hostMetadata: null,
	});
	const fixtureAgentContext = new AgentContext({
		startGitBranch: null,
		startGitCommitSha: null,
		startWorktreeDir: null,
	});

	return Layer.mergeAll(
		DataStoreLive.pipe(Layer.provide(ProjectSqliteLayer)),
		DataReaderLive.pipe(Layer.provide(ProjectSqliteLayer)),
		ProjectMigratorLayer,
		PerClientSessionMapWriterLive.pipe(Layer.provide(SessionMapSqliteLayer)),
		SessionMapMigratorLayer,
		RunContextTest({ runContext: fixtureRunContext, agentContext: fixtureAgentContext }),
		PlatformLayer,
	);
};

const run = <A, E, R, LE>(effect: Effect.Effect<A, E, R>, layer: Layer.Layer<R, LE, never>) =>
	Effect.runPromise(Effect.provide(effect, layer));

describe("registerAgentEffect populates sessions.conversation_id (issue #144)", () => {
	it("backfills conversation_id on a session row that pre-existed with a null value", async () => {
		const layer = buildLive();
		const conversationId = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const reader = yield* DataReader;

				// Simulate `record session-start` having already inserted
				// the row, before `register-agent` runs and resolves the
				// canonical conversation id.
				yield* store.writeSession({
					chatId: "host-session-preexisting",
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "main",
					startedAt: "2026-04-29T00:00:00Z",
				});

				yield* registerAgentEffect({
					hostSessionId: "host-session-preexisting",
					transcriptPath: "/tmp/transcript-preexisting.jsonl",
					cwd: "/tmp/demo",
					hostKind: "claude-code",
					agentType: "claude-code-main",
					projectKey: "demo",
				});

				const sessionOpt = yield* reader.getSessionByChatId("host-session-preexisting");
				return Option.isSome(sessionOpt) ? sessionOpt.value.conversationId : null;
			}),
			layer,
		);
		expect(conversationId).not.toBeNull();
		expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("sets conversation_id on a session row created fresh by registerAgentEffect", async () => {
		const layer = buildLive();
		const conversationId = await run(
			Effect.gen(function* () {
				const reader = yield* DataReader;

				yield* registerAgentEffect({
					hostSessionId: "host-session-fresh",
					transcriptPath: "/tmp/transcript-fresh.jsonl",
					cwd: "/tmp/demo",
					hostKind: "claude-code",
					agentType: "claude-code-main",
					projectKey: "demo",
				});

				const sessionOpt = yield* reader.getSessionByChatId("host-session-fresh");
				return Option.isSome(sessionOpt) ? sessionOpt.value.conversationId : null;
			}),
			layer,
		);
		expect(conversationId).not.toBeNull();
		expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);
	});
});

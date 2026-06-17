import * as NodeContext from "@effect/platform-node/NodeContext";
import { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import type { DataReader, DataStore } from "@vitest-agent/sdk";
import { DataReaderLive, DataReader as DataReaderTag, DataStoreLive, migration0001 } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { recordRunWorkspaceChangesEffect } from "../src/lib/record-workspace-changes.js";

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

describe("recordRunWorkspaceChangesEffect", () => {
	it("writes a commit and the file list, no run_id required", async () => {
		const result = await run(
			Effect.gen(function* () {
				const reader = yield* DataReaderTag;
				yield* recordRunWorkspaceChangesEffect({
					sha: "abc1234",
					message: "feat: add foo",
					author: "Test <t@example.com>",
					committedAt: "2026-04-29T00:00:00Z",
					branch: "main",
					files: [
						{ filePath: "/abs/src/foo.ts", changeKind: "modified" },
						{ filePath: "/abs/src/bar.ts", changeKind: "added" },
					],
				});
				return yield* reader.getCommitChanges("abc1234");
			}),
		);
		expect(result).toHaveLength(1);
		expect(result[0].sha).toBe("abc1234");
	});

	it("returns fileRowsWritten=0 when no test_runs exist for the project", async () => {
		const result = await run(
			recordRunWorkspaceChangesEffect({
				sha: "no-runs-yet",
				files: [{ filePath: "/abs/src/x.ts", changeKind: "modified" }],
			}),
		);
		expect(result.sha).toBe("no-runs-yet");
		expect(result.fileRowsWritten).toBe(0);
	});

	it("associates files with the most-recent run when one exists", async () => {
		const result = await run(
			Effect.gen(function* () {
				// Seed a settings row + a test run via direct SQL so we don't need
				// to wire writeRun's full input.
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO settings (hash, vitest_version)
					VALUES ('h0', '4.1.5')`;
				yield* sql`INSERT INTO test_runs
					(invocation_id, project, settings_hash, timestamp, reason,
					 duration, total, passed, failed, skipped)
					VALUES ('inv-1', 'demo', 'h0', '2026-04-29T00:00:00Z', 'passed',
					 100, 1, 1, 0, 0)`;

				const reader = yield* DataReaderTag;
				const wcr = yield* recordRunWorkspaceChangesEffect({
					sha: "run-shaaaa",
					project: "demo",
					files: [{ filePath: "/abs/src/seed.ts", changeKind: "added" }],
				});
				const changes = yield* reader.getCommitChanges("run-shaaaa");
				return { wcr, changes };
			}),
		);
		expect(result.wcr.fileRowsWritten).toBe(1);
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0].files).toHaveLength(1);
		expect(result.changes[0].files[0].filePath).toBe("/abs/src/seed.ts");
	});
});

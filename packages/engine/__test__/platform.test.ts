import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { PlatformLive } from "../src/platform.js";
import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";
import { HistoryTracker } from "../src/services/HistoryTracker.js";
import { OutputRenderer } from "../src/services/OutputRenderer.js";
import { ProjectDiscovery } from "../src/services/ProjectDiscovery.js";

describe("PlatformLive", () => {
	it("composes the five services over an in-memory SQLite and runs the migrations", async () => {
		const program = Effect.gen(function* () {
			const ctx = yield* Layer.build(PlatformLive({ dbPath: ":memory:", env: {} }));
			const reader = Context.get(ctx, DataReader);
			const store = Context.get(ctx, DataStore);
			const discovery = Context.get(ctx, ProjectDiscovery);
			const tracker = Context.get(ctx, HistoryTracker);
			const renderer = Context.get(ctx, OutputRenderer);
			const sql = Context.get(ctx, SqlClient);
			// The project "runs" table is `test_runs` (0001_initial); its presence
			// proves the migrator fired as part of layer acquisition.
			const rows = yield* sql<{
				readonly name: string;
			}>`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('test_runs', 'test_artifacts') ORDER BY name`;
			return { reader, store, discovery, tracker, renderer, tables: rows.map((r) => r.name) };
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program);

		expect(result.reader).toBeDefined();
		expect(result.store).toBeDefined();
		expect(result.discovery).toBeDefined();
		expect(result.tracker).toBeDefined();
		expect(result.renderer).toBeDefined();
		expect(result.tables).toEqual(["test_artifacts", "test_runs"]);
	});
});

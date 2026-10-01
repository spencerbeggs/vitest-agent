import { Context, Effect, Layer, Logger } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
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

	describe("logger option", () => {
		/**
		 * Log one line inside `PlatformLive` while an OUTER logger set (standing
		 * in for a front end's `CliLog`) is installed around it, and return what
		 * the outer logger saw.
		 */
		const outerSees = async (logger: boolean | undefined) => {
			const seen: Array<unknown> = [];
			const outer = Logger.layer([Logger.make(({ message }) => void seen.push(message))]);
			await Effect.runPromise(
				Effect.logInfo("inside-platform").pipe(
					Effect.provide(PlatformLive({ dbPath: ":memory:", env: {}, ...(logger === undefined ? {} : { logger }) })),
					Effect.provide(outer),
				),
			);
			return seen.flat();
		};

		it("logger: false leaves the caller's logger set in place", async () => {
			expect(await outerSees(false)).toEqual(["inside-platform"]);
		});

		it("by default (and with logger: true) LoggerLive replaces the caller's set, silent with no level", async () => {
			expect(await outerSees(undefined)).toEqual([]);
			expect(await outerSees(true)).toEqual([]);
		});
	});
});

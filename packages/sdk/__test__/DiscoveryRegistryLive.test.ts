import * as NodeContext from "@effect/platform-node/NodeContext";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { DiscoveryRegistryLive } from "../src/layers/DiscoveryRegistryLive.js";
import registryMigration from "../src/migrations/registry_0001_initial.js";
import { DiscoveryRegistry } from "../src/services/DiscoveryRegistry.js";

const makeRegistryLayer = () => {
	const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
	const PlatformLayer = NodeContext.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({ "0001_initial": registryMigration }),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
	return Layer.mergeAll(
		DiscoveryRegistryLive.pipe(Layer.provide(SqliteLayer)),
		MigratorLayer,
		SqliteLayer,
		PlatformLayer,
	);
};

const sample = {
	projectKey: "github.com__foo__bar",
	canonicalForm: "github.com/foo/bar",
	dataDbPath: "/data/foo/bar/data.db",
	gitRemoteOrigin: "git@github.com:foo/bar.git",
	workspaceRoot: "/repo",
};

describe("DiscoveryRegistryLive", () => {
	it("inserts a new project on first recordProject call", async () => {
		const program = Effect.gen(function* () {
			const reg = yield* DiscoveryRegistry;
			yield* reg.recordProject(sample);
			return yield* reg.listProjects();
		}).pipe(Effect.provide(makeRegistryLayer()));
		const projects = await Effect.runPromise(program);
		expect(projects).toHaveLength(1);
		expect(projects[0]?.projectKey).toBe(sample.projectKey);
		expect(projects[0]?.firstSeenAt).toBeGreaterThan(0);
		expect(projects[0]?.lastSeenAt).toBeGreaterThanOrEqual(projects[0]?.firstSeenAt ?? 0);
	});

	it("upserts on conflict, updating last_seen_at and mutable fields", async () => {
		const program = Effect.gen(function* () {
			const reg = yield* DiscoveryRegistry;
			yield* reg.recordProject(sample);
			yield* reg.recordProject({ ...sample, dataDbPath: "/data/foo/bar/data.db.NEW" });
			return yield* reg.listProjects();
		}).pipe(Effect.provide(makeRegistryLayer()));
		const projects = await Effect.runPromise(program);
		expect(projects).toHaveLength(1);
		expect(projects[0]?.dataDbPath).toBe("/data/foo/bar/data.db.NEW");
	});

	it("listProjects orders by last_seen_at desc", async () => {
		const program = Effect.gen(function* () {
			const reg = yield* DiscoveryRegistry;
			yield* reg.recordProject(sample);
			yield* reg.recordProject({ ...sample, projectKey: "second", canonicalForm: "second" });
			return yield* reg.listProjects();
		}).pipe(Effect.provide(makeRegistryLayer()));
		const projects = await Effect.runPromise(program);
		expect(projects).toHaveLength(2);
		expect(projects[0]?.projectKey).toBe("second");
	});

	it("prune returns 0 when no rows are old enough", async () => {
		const program = Effect.gen(function* () {
			const reg = yield* DiscoveryRegistry;
			yield* reg.recordProject(sample);
			return yield* reg.prune(90);
		}).pipe(Effect.provide(makeRegistryLayer()));
		const removed = await Effect.runPromise(program);
		expect(removed).toBe(0);
	});

	it("prune does not remove projects within the maxAge window", async () => {
		const program = Effect.gen(function* () {
			const reg = yield* DiscoveryRegistry;
			yield* reg.recordProject(sample);
			// One-day window is generous enough that ms-resolution clock
			// skew between insert and prune cannot push the row past the
			// cutoff.
			yield* reg.prune(1);
			return yield* reg.listProjects();
		}).pipe(Effect.provide(makeRegistryLayer()));
		const projects = await Effect.runPromise(program);
		expect(projects).toHaveLength(1);
	});
});

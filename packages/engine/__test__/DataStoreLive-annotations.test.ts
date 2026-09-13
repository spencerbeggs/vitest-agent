import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataReaderLive } from "../src/layers/DataReaderLive.js";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import migration0001 from "../src/migrations/0001_initial.js";
import migration0002 from "../src/migrations/0002_test_artifacts.js";
import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeServices.layer;
const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({
		"0001_initial": migration0001,
		"0002_test_artifacts": migration0002,
	} as never),
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

let seq = 0;

const seed = Effect.gen(function* () {
	const store = yield* DataStore;
	seq += 1;
	const project = `pkg-${seq}`;
	const hash = `h-${seq}`;
	yield* store.writeSettings(hash, { vitestVersion: "5.0.0" }, {});
	const runId = yield* store.writeRun({
		invocationId: `inv-anno-${seq}`,
		project,
		settingsHash: hash,
		timestamp: "2026-09-07T00:00:00.000Z",
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
	const modulePath = `src/a-${seq}.test.ts`;
	const fileId = yield* store.ensureFile(modulePath);
	const moduleIds = yield* store.writeModules(runId, [
		{ fileId, relativeModuleId: modulePath, state: "passed", duration: 5 },
	]);
	const testCaseIds = yield* store.writeTestCases(moduleIds[0], [
		{ name: "works", fullName: "works", state: "passed" },
	]);
	return { project, runId, modulePath, testCaseId: testCaseIds[0] };
});

describe("DataStore annotations and artifacts", () => {
	it("persists an annotation with a non-enum type and reads it back", async () => {
		const rows = await run(
			Effect.gen(function* () {
				const { project, runId, testCaseId } = yield* seed;
				const store = yield* DataStore;
				yield* store.writeAnnotations(runId, [
					{
						testCaseId,
						type: "issues",
						message: "known slow under CI",
						locationFile: "src/a.test.ts",
						locationLine: 12,
						locationColumn: 3,
						attachments: [],
					},
				]);
				const reader = yield* DataReader;
				return yield* reader.getAnnotationsForTest(project, "works");
			}),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe("issues");
		expect(rows[0].location).toEqual({ file: "src/a.test.ts", line: 12, column: 3 });
	});

	it("stores an attachment path and size but drops a body over 64 KiB", async () => {
		const big = "x".repeat(70_000);
		const rows = await run(
			Effect.gen(function* () {
				const { project, runId, testCaseId } = yield* seed;
				const store = yield* DataStore;
				yield* store.writeArtifacts(runId, [
					{
						testCaseId,
						type: "my-pkg:trace",
						data: JSON.stringify({ spans: 2 }),
						attachments: [
							{ contentType: "text/plain", body: big, byteSize: big.length },
							{ contentType: "image/png", path: ".vitest/attachments/s.png", byteSize: 2048 },
						],
					},
				]);
				const reader = yield* DataReader;
				return yield* reader.getArtifactsForTest(project, "works");
			}),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].data).toBe(JSON.stringify({ spans: 2 }));
		expect(rows[0].attachments).toHaveLength(2);
		expect(rows[0].attachments[0].body).toBeUndefined();
		expect(rows[0].attachments[0].byteSize).toBe(70_000);
		expect(rows[0].attachments[1].path).toBe(".vitest/attachments/s.png");
	});

	it("keeps an inline body under the cap and round-trips its encoding", async () => {
		const rows = await run(
			Effect.gen(function* () {
				const { project, runId, testCaseId } = yield* seed;
				const store = yield* DataStore;
				yield* store.writeAnnotations(runId, [
					{
						testCaseId,
						type: "notice",
						message: "small note",
						attachments: [{ contentType: "text/plain", body: "hello", bodyEncoding: "utf-8", byteSize: 5 }],
					},
				]);
				const reader = yield* DataReader;
				return yield* reader.getAnnotationsForTest(project, "works");
			}),
		);
		expect(rows[0].attachments[0].body).toBe("hello");
		expect(rows[0].attachments[0].bodyEncoding).toBe("utf-8");
	});

	it("caps the inline body on its stored length, not on the reported byteSize", async () => {
		// A caller that under-reports (or zero-reports) byteSize must not be
		// able to smuggle an arbitrarily large string into data.db. The same
		// guard covers a base64 body, whose stored string is 4/3 the size it
		// reports.
		const big = "x".repeat(70_000);
		const rows = await run(
			Effect.gen(function* () {
				const { project, runId, testCaseId } = yield* seed;
				const store = yield* DataStore;
				yield* store.writeAnnotations(runId, [
					{
						testCaseId,
						type: "notice",
						message: "under-reported size",
						attachments: [{ contentType: "text/plain", body: big, bodyEncoding: "utf-8", byteSize: 10 }],
					},
				]);
				const reader = yield* DataReader;
				return yield* reader.getAnnotationsForTest(project, "works");
			}),
		);
		expect(rows[0].attachments[0].body).toBeUndefined();
		expect(rows[0].attachments[0].bodyEncoding).toBeUndefined();
		// byte_size is still recorded exactly as the caller reported it.
		expect(rows[0].attachments[0].byteSize).toBe(10);
	});

	it("returns the row when the module path matches", async () => {
		const rows = await run(
			Effect.gen(function* () {
				const { project, runId, modulePath, testCaseId } = yield* seed;
				const store = yield* DataStore;
				yield* store.writeAnnotations(runId, [{ testCaseId, type: "notice", message: "in module a", attachments: [] }]);
				const reader = yield* DataReader;
				return yield* reader.getAnnotationsForTest(project, "works", { modulePath });
			}),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].message).toBe("in module a");
	});

	it("scopes reads to a module path when one is given", async () => {
		const rows = await run(
			Effect.gen(function* () {
				const { project, runId, testCaseId } = yield* seed;
				const store = yield* DataStore;
				yield* store.writeAnnotations(runId, [{ testCaseId, type: "notice", message: "in module a", attachments: [] }]);
				const reader = yield* DataReader;
				return yield* reader.getAnnotationsForTest(project, "works", { modulePath: "src/elsewhere.test.ts" });
			}),
		);
		expect(rows).toHaveLength(0);
	});

	it("returns nothing for a project that has never run", async () => {
		const rows = await run(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				return yield* reader.getArtifactsForTest("no-such-project", "works");
			}),
		);
		expect(rows).toEqual([]);
	});
});

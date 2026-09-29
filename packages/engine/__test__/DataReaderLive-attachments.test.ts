import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
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

// Every statement the reader issues, recorded as its template text. Only the
// reader's SqlClient is wrapped, so the DataStore seeding writes are not counted.
const statements: Array<string> = [];
const CountingSqlLayer = Layer.effect(
	SqlClient,
	Effect.gen(function* () {
		const base = yield* SqlClient;
		return new Proxy(base, {
			apply(target, thisArg, args) {
				const first = args[0];
				if (Array.isArray(first)) statements.push(first.join("?"));
				return Reflect.apply(target as never, thisArg, args);
			},
		});
	}),
).pipe(Layer.provide(SqliteLayer));

const TestLayer = Layer.mergeAll(
	DataStoreLive.pipe(Layer.provide(SqliteLayer)),
	DataReaderLive.pipe(Layer.provide(CountingSqlLayer)),
	MigratorLayer,
	SqliteLayer,
	PlatformLayer,
);

const run = <A, E>(effect: Effect.Effect<A, E, DataStore | DataReader | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, TestLayer));

const attachmentQueries = () => statements.filter((s) => /FROM attachments/i.test(s));

let seq = 0;
const seed = Effect.gen(function* () {
	const store = yield* DataStore;
	seq += 1;
	const project = `pkg-att-${seq}`;
	const hash = `h-att-${seq}`;
	yield* store.writeSettings(hash, { vitestVersion: "5.0.0" }, {});
	const runId = yield* store.writeRun({
		invocationId: `inv-att-${seq}`,
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
	const modulePath = `src/att-${seq}.test.ts`;
	const fileId = yield* store.ensureFile(modulePath);
	const moduleIds = yield* store.writeModules(runId, [
		{ fileId, relativeModuleId: modulePath, state: "passed", duration: 5 },
	]);
	const testCaseIds = yield* store.writeTestCases(moduleIds[0], [
		{ name: "works", fullName: "works", state: "passed" },
	]);
	return { project, runId, testCaseId: testCaseIds[0] };
});

const att = (n: number) => ({ contentType: "text/plain", body: `b${n}`, bodyEncoding: "utf-8" as const, byteSize: 2 });

describe("DataReaderLive attachments batching", () => {
	it("should query attachments once per call when reading annotations with several owners", async () => {
		statements.length = 0;
		const rows = await run(
			Effect.gen(function* () {
				const { project, runId, testCaseId } = yield* seed;
				const store = yield* DataStore;
				yield* store.writeAnnotations(runId, [
					{ testCaseId, type: "a", message: "m0", attachments: [] },
					{ testCaseId, type: "b", message: "m1", attachments: [att(1)] },
					{ testCaseId, type: "c", message: "m2", attachments: [att(2), att(3), att(4)] },
					{ testCaseId, type: "d", message: "m3", attachments: [att(5)] },
				]);
				const reader = yield* DataReader;
				statements.length = 0;
				return yield* reader.getAnnotationsForTest(project, "works");
			}),
		);
		expect(attachmentQueries()).toHaveLength(1);
		expect(rows.map((r) => r.attachments.map((a) => a.body))).toEqual([[], ["b1"], ["b2", "b3", "b4"], ["b5"]]);
	});

	it("should query attachments once per call when reading artifacts with several owners", async () => {
		const rows = await run(
			Effect.gen(function* () {
				const { project, runId, testCaseId } = yield* seed;
				const store = yield* DataStore;
				yield* store.writeArtifacts(runId, [
					{ testCaseId, type: "t:a", attachments: [att(1), att(2)] },
					{ testCaseId, type: "t:b", attachments: [] },
					{ testCaseId, type: "t:c", attachments: [att(3)] },
				]);
				const reader = yield* DataReader;
				statements.length = 0;
				return yield* reader.getArtifactsForTest(project, "works");
			}),
		);
		expect(attachmentQueries()).toHaveLength(1);
		expect(rows.map((r) => r.attachments.map((a) => a.body))).toEqual([["b1", "b2"], [], ["b3"]]);
	});

	it("should issue no attachments query when the test has no annotations", async () => {
		await run(
			Effect.gen(function* () {
				const { project } = yield* seed;
				const reader = yield* DataReader;
				statements.length = 0;
				yield* reader.getAnnotationsForTest(project, "works");
			}),
		);
		expect(attachmentQueries()).toHaveLength(0);
	});
});

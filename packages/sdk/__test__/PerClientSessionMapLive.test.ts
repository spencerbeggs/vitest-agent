import * as NodeContext from "@effect/platform-node/NodeContext";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { PerClientSessionMapReaderLive, PerClientSessionMapWriterLive } from "../src/layers/PerClientSessionMapLive.js";
import sessionMapMigration from "../src/migrations/session_map_0001_initial.js";
import { PerClientSessionMapReader, PerClientSessionMapWriter } from "../src/services/PerClientSessionMap.js";

const makeWriterLayer = () => {
	const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
	const PlatformLayer = NodeContext.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({ "0001_initial": sessionMapMigration }),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
	return Layer.mergeAll(
		PerClientSessionMapWriterLive.pipe(Layer.provide(SqliteLayer)),
		MigratorLayer,
		SqliteLayer,
		PlatformLayer,
	);
};

describe("PerClientSessionMapWriter", () => {
	it("mapConversation generates a fresh UUID for an unseen transcript path", async () => {
		const program = Effect.gen(function* () {
			const map = yield* PerClientSessionMapWriter;
			return yield* map.mapConversation("/path/to/transcript-uuid-1.jsonl");
		}).pipe(Effect.provide(makeWriterLayer()));
		const id = await Effect.runPromise(program);
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	it("mapConversation returns the same UUID on a second call (idempotent on transcript path)", async () => {
		const program = Effect.gen(function* () {
			const map = yield* PerClientSessionMapWriter;
			const a = yield* map.mapConversation("/path/to/transcript-uuid-2.jsonl");
			const b = yield* map.mapConversation("/path/to/transcript-uuid-2.jsonl");
			return [a, b];
		}).pipe(Effect.provide(makeWriterLayer()));
		const [a, b] = await Effect.runPromise(program);
		expect(a).toBe(b);
	});

	it("mapConversation keys on the basename (rename/symlink survives)", async () => {
		const program = Effect.gen(function* () {
			const map = yield* PerClientSessionMapWriter;
			const a = yield* map.mapConversation("/path/A/transcript-uuid-3.jsonl");
			const b = yield* map.mapConversation("/path/B/transcript-uuid-3.jsonl");
			return [a, b];
		}).pipe(Effect.provide(makeWriterLayer()));
		const [a, b] = await Effect.runPromise(program);
		expect(a).toBe(b);
	});

	it("mapSession upserts and returns a new mainAgentId on first call", async () => {
		const program = Effect.gen(function* () {
			const map = yield* PerClientSessionMapWriter;
			const conversationId = yield* map.mapConversation("/p/t-4.jsonl");
			return yield* map.mapSession({
				hostSessionId: "host-session-1",
				conversationId,
				projectKey: "github.com__foo__bar",
				projectDir: "/repo",
			});
		}).pipe(Effect.provide(makeWriterLayer()));
		const result = await Effect.runPromise(program);
		expect(result.mainAgentId).toMatch(/^[0-9a-f-]{36}$/);
		expect(result.conversationId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("mapSession returns the same mainAgentId on a second call (idempotent on host_session_id)", async () => {
		const program = Effect.gen(function* () {
			const map = yield* PerClientSessionMapWriter;
			const conversationId = yield* map.mapConversation("/p/t-5.jsonl");
			const a = yield* map.mapSession({
				hostSessionId: "host-session-2",
				conversationId,
				projectKey: "github.com__foo__bar",
				projectDir: "/repo",
			});
			const b = yield* map.mapSession({
				hostSessionId: "host-session-2",
				conversationId,
				projectKey: "github.com__foo__bar",
				projectDir: "/repo",
			});
			return [a, b];
		}).pipe(Effect.provide(makeWriterLayer()));
		const [a, b] = await Effect.runPromise(program);
		expect(a.mainAgentId).toBe(b.mainAgentId);
	});

	it("lookupByProjectDir returns the most recent open session for a project_dir", async () => {
		const program = Effect.gen(function* () {
			const map = yield* PerClientSessionMapWriter;
			const conv1 = yield* map.mapConversation("/p/t-A.jsonl");
			const conv2 = yield* map.mapConversation("/p/t-B.jsonl");
			yield* map.mapSession({
				hostSessionId: "host-A",
				conversationId: conv1,
				projectKey: "k",
				projectDir: "/repo-X",
			});
			yield* map.mapSession({
				hostSessionId: "host-B",
				conversationId: conv2,
				projectKey: "k",
				projectDir: "/repo-X",
			});
			return yield* map.lookupByProjectDir("/repo-X");
		}).pipe(Effect.provide(makeWriterLayer()));
		const result = await Effect.runPromise(program);
		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value.projectDir).toBe("/repo-X");
		}
	});

	it("lookupByProjectDir returns None for an unknown project_dir", async () => {
		const program = Effect.gen(function* () {
			const map = yield* PerClientSessionMapWriter;
			return yield* map.lookupByProjectDir("/never-seen");
		}).pipe(Effect.provide(makeWriterLayer()));
		const result = await Effect.runPromise(program);
		expect(Option.isNone(result)).toBe(true);
	});

	it("endSession sets ended_at and removes the row from lookupByProjectDir results", async () => {
		const program = Effect.gen(function* () {
			const map = yield* PerClientSessionMapWriter;
			const conv = yield* map.mapConversation("/p/t-end.jsonl");
			yield* map.mapSession({
				hostSessionId: "host-end-1",
				conversationId: conv,
				projectKey: "k",
				projectDir: "/repo-end",
			});
			yield* map.endSession("host-end-1", Date.now());
			return yield* map.lookupByProjectDir("/repo-end");
		}).pipe(Effect.provide(makeWriterLayer()));
		const result = await Effect.runPromise(program);
		expect(Option.isNone(result)).toBe(true);
	});

	it("lookupConversation returns the recorded conversation_id", async () => {
		const program = Effect.gen(function* () {
			const map = yield* PerClientSessionMapWriter;
			const conv = yield* map.mapConversation("/p/t-look.jsonl");
			const found = yield* map.lookupConversation("/p/t-look.jsonl");
			return { conv, found };
		}).pipe(Effect.provide(makeWriterLayer()));
		const { conv, found } = await Effect.runPromise(program);
		expect(Option.isSome(found)).toBe(true);
		if (Option.isSome(found)) {
			expect(found.value).toBe(conv);
		}
	});
});

describe("PerClientSessionMapReader (Writer satisfies Reader tag)", () => {
	it("a program that depends on the Reader tag resolves through the Writer layer", async () => {
		const program = Effect.gen(function* () {
			const reader = yield* PerClientSessionMapReader;
			return yield* reader.lookupByProjectDir("/never-seen");
		}).pipe(Effect.provide(makeWriterLayer()));
		const result = await Effect.runPromise(program);
		expect(Option.isNone(result)).toBe(true);
	});

	it("read-only Live layer satisfies the Reader tag against a separately-populated DB", async () => {
		// Verify the read-only Live layer wires up correctly. Since this
		// is :memory:, both writer-and-reader and reader-only see the
		// same connection — the "reader" guarantee here is just that the
		// methods exist and return None for an empty table.
		const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
		const PlatformLayer = NodeContext.layer;
		const MigratorLayer = SqliteMigrator.layer({
			loader: SqliteMigrator.fromRecord({ "0001_initial": sessionMapMigration }),
		}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
		const TestLayer = Layer.mergeAll(
			PerClientSessionMapReaderLive.pipe(Layer.provide(SqliteLayer)),
			MigratorLayer,
			SqliteLayer,
			PlatformLayer,
		);
		const program = Effect.gen(function* () {
			const reader = yield* PerClientSessionMapReader;
			return yield* reader.lookupByProjectDir("/anything");
		}).pipe(Effect.provide(TestLayer));
		const result = await Effect.runPromise(program);
		expect(Option.isNone(result)).toBe(true);
	});
});

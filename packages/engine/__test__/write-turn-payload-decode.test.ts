import { DataStoreError } from "@vitest-agent/sdk";
import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataStore } from "../src/services/DataStore.js";
import { makeTestLayer } from "../src/testing/layers.js";

// `writeTurn` fans `file_edit` / `tool_result` payloads out into their own
// tables. The payload text is decoded against the variant's schema, so a
// body that is valid JSON but not the variant's shape (`null`, an array, a
// missing field) is a typed `DataStoreError`, never a defect, and writes no
// row at all (the savepoint rolls back the `turns` insert).
const writeTurnExit = (type: "file_edit" | "tool_result", payload: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const ds = yield* DataStore;
			const sql = yield* SqlClient;
			const sessionId = yield* ds.writeSession({
				chatId: "cc-decode",
				project: "p",
				cwd: "/tmp/p",
				agentKind: "main",
				startedAt: "2026-04-29T00:00:00Z",
			});
			const error = yield* Effect.flip(ds.writeTurn({ sessionId, type, payload, occurredAt: "2026-04-29T00:00:01Z" }));
			const turns = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM turns`;
			return { error, turns: turns[0].n };
		}).pipe(Effect.provide(makeTestLayer(":memory:"))),
	);

describe("writeTurn fanout payload decode", () => {
	for (const [type, payload] of [
		["file_edit", "null"],
		["file_edit", "[1]"],
		["file_edit", JSON.stringify({ type: "file_edit", edit_kind: "edit" })],
		["tool_result", "null"],
		["tool_result", "42"],
		["tool_result", JSON.stringify({ type: "tool_result", tool_name: "Bash" })],
		["tool_result", "{ not json"],
	] as const) {
		it(`${type} ${payload} fails typed and writes nothing`, async () => {
			const { error, turns } = await writeTurnExit(type, payload);
			expect(error).toBeInstanceOf(DataStoreError);
			expect(error.table).toBe(type === "file_edit" ? "file_edits" : "tool_invocations");
			expect(error.reason).toMatch(/^invalid turn payload/);
			expect(turns).toBe(0);
		});
	}
});

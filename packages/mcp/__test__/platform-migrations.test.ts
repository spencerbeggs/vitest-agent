import { DataReader, DataStore, PlatformLive } from "@vitest-agent/engine";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

// Regression: the MCP server's runtime layer (the engine's `PlatformLive`, provided by `main.ts`) must register every project-database migration, not
// just `0001_initial`. Reading artifacts touches `test_artifacts.data`, a
// column added by `0002_test_artifacts`; a layer stuck on `0001` fails the
// query with `no such column: ta.data`.
// A fresh `:memory:` database is as fresh as a new file for this purpose
// (`PlatformOptions.dbPath` accepts it, and the layer creates no directory).

describe("PlatformLive migrations (MCP server layer)", () => {
	it("reads artifacts on a fresh database opened through the layer alone", async () => {
		const program = Effect.gen(function* () {
			const store = yield* DataStore;
			const reader = yield* DataReader;
			yield* store.writeSettings("hash-mcp-live", { vitestVersion: "5.0.0" }, {});
			yield* store.writeRun({
				invocationId: "inv-mcp-live",
				project: "pkg",
				settingsHash: "hash-mcp-live",
				timestamp: "2026-09-07T00:00:00.000Z",
				commitSha: null,
				branch: null,
				reason: "passed",
				duration: 1,
				total: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
				scoped: false,
			});
			return yield* reader.getArtifactsForTest("pkg", "does not exist");
		});

		const rows = await Effect.runPromise(Effect.provide(program, PlatformLive({ dbPath: ":memory:", env: {} })));

		expect(rows).toStrictEqual([]);
	});
});

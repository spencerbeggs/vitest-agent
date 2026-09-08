import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataReader, DataStore } from "@vitest-agent/sdk";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { McpLive } from "../src/layers/McpLive.js";

// Regression: `McpLive` must register every project-database migration, not
// just `0001_initial`. Reading artifacts touches `test_artifacts.data`, a
// column added by `0002_test_artifacts`; a layer stuck on `0001` fails the
// query with `no such column: ta.data`.
const dir = mkdtempSync(join(tmpdir(), "vitest-agent-mcp-live-"));

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("McpLive migrations", () => {
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

		const rows = await Effect.runPromise(Effect.provide(program, McpLive(join(dir, "data.db"))));

		expect(rows).toStrictEqual([]);
	});
});

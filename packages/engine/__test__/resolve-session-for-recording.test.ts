import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { resolveSessionForRecording } from "../src/programs/resolve-session-for-recording.js";
import { makeTestLayer } from "../src/testing/layers.js";

const CWD = "/work/app";

/** Bootstrap a session row with no explicit `project`, so the name comes from `${cwd}/package.json`. */
const bootstrapProject = (seed: MemoryFileSystemSeed) =>
	Effect.runPromise(
		resolveSessionForRecording({ chatId: "chat-1", recordedAt: "2026-10-26T00:00:00Z", cwd: CWD }).pipe(
			Effect.map((session) => session.project),
			Effect.provide(MemoryFileSystem.layerWith(seed)),
			Effect.provide(makeTestLayer(":memory:")),
		),
	);

describe("resolveSessionForRecording bootstrap project name", () => {
	it("uses package.json#name in cwd", async () => {
		expect(await bootstrapProject({ [`${CWD}/package.json`]: JSON.stringify({ name: "@scope/app" }) })).toBe(
			"@scope/app",
		);
	});

	it("keeps an empty-string name as given", async () => {
		expect(await bootstrapProject({ [`${CWD}/package.json`]: JSON.stringify({ name: "" }) })).toBe("");
	});

	it("falls back to unknown for a missing, malformed, non-object or name-less package.json", async () => {
		const cases: ReadonlyArray<MemoryFileSystemSeed> = [
			{ [CWD]: MemoryFileSystem.directory() },
			{ [`${CWD}/package.json`]: "{ not json" },
			{ [`${CWD}/package.json`]: '{ // c\n "name": "commented" }' },
			{ [`${CWD}/package.json`]: "[]" },
			{ [`${CWD}/package.json`]: JSON.stringify({ name: 42 }) },
			{ [`${CWD}/package.json`]: JSON.stringify({ version: "1.0.0" }) },
		];
		for (const seed of cases) {
			expect(await bootstrapProject(seed)).toBe("unknown");
		}
	});

	it("does not walk upward: a parent package.json is not consulted", async () => {
		expect(
			await bootstrapProject({
				"/work/package.json": JSON.stringify({ name: "parent" }),
				[CWD]: MemoryFileSystem.directory(),
			}),
		).toBe("unknown");
	});
});

import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ProjectDiscoveryLive } from "../src/layers/ProjectDiscoveryLive.js";
import { resolveSessionForRecording } from "../src/programs/resolve-session-for-recording.js";
import { ProjectDiscovery } from "../src/services/ProjectDiscovery.js";
import { makeTestLayer } from "../src/testing/layers.js";
import { resolveProjectKeyFromCwdEffect } from "../src/utils/resolve-project-key-from-cwd.js";
import { win32Volume } from "./utils/win32-volume.js";

// The engine runs on win32 (a win32 sidecar ships, and the CLI and MCP run
// under Node on Windows). Every path it builds must come from the ambient
// `Path` service, which `PlatformLive` supplies as the host's Node `Path`;
// these tests drive the code with Node's win32 `Path` over a volume that
// accepts win32 spellings.

describe("win32 paths", () => {
	it("resolveProjectKeyFromCwdEffect walks upward through a win32 cwd", async () => {
		const key = await Effect.runPromise(
			resolveProjectKeyFromCwdEffect("C:\\work\\project\\src\\deep").pipe(
				Effect.provide(
					win32Volume({
						"C:\\work\\project\\package.json": JSON.stringify({ name: "outer-app" }),
						"C:\\work\\project\\src\\deep": MemoryFileSystem.directory(),
					}),
				),
			),
		);
		expect(key).toBe("outer-app");
	});

	it("resolveProjectKeyFromCwdEffect falls back to the win32 cwd basename", async () => {
		const key = await Effect.runPromise(
			resolveProjectKeyFromCwdEffect("C:\\work\\project").pipe(
				Effect.provide(win32Volume({ "C:\\work\\project": MemoryFileSystem.directory() })),
			),
		);
		expect(key).toBe("project");
	});

	it("ProjectDiscoveryLive returns win32-joined test and source paths", async () => {
		const entries = await Effect.runPromise(
			Effect.flatMap(ProjectDiscovery, (pd) => pd.discoverTestFiles("C:\\project")).pipe(
				Effect.provide(ProjectDiscoveryLive),
				Effect.provide(
					win32Volume({
						"C:\\project\\src\\a.ts": "export const a = 1;",
						"C:\\project\\src\\a.test.ts": "test('a', () => {});",
					}),
				),
			),
		);
		expect(entries).toEqual([{ testFile: "C:\\project\\src\\a.test.ts", sourceFiles: ["C:\\project\\src\\a.ts"] }]);
	});

	it("resolveSessionForRecording reads package.json#name under a win32 cwd", async () => {
		const project = await Effect.runPromise(
			resolveSessionForRecording({ chatId: "chat-1", recordedAt: "2026-10-26T00:00:00Z", cwd: "C:\\work\\app" }).pipe(
				Effect.map((session) => session.project),
				Effect.provide(win32Volume({ "C:\\work\\app\\package.json": JSON.stringify({ name: "@scope/app" }) })),
				Effect.provide(makeTestLayer(":memory:")),
			),
		);
		expect(project).toBe("@scope/app");
	});
});

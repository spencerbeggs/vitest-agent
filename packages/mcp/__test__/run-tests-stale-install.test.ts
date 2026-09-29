/**
 * Issue #461 (server half): the MCP server is long-lived. When the lockfile is
 * regenerated mid-session, pnpm can rename vitest's `.pnpm` store directory, so
 * the `vitest/node` entry the server resolves no longer exists on disk and
 * every `run_tests` call fails opaquely inside the fork pool ("Worker forks
 * emitted error", total: 0). `run_tests` must instead return the tool's normal
 * `{ kind: "error" }` envelope naming the missing path and the restart remedy,
 * before loading or creating Vitest.
 *
 * Seam: `vitestLoader.resolveEntry` and `vitestLoader.load` are plain mutable
 * properties; tests substitute both so no real node_modules is touched.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ProjectDiscoveryTest } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import { Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpSession } from "../src/session.js";
import { vitestLoader } from "../src/tools/run-tests.js";
import { makeCaller as makeToolCaller } from "./utils/caller.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, ProjectDiscoveryTest.layer([]));

describe("run_tests stale vitest install guard (issue #461)", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Layer.Success<typeof TestLayer>, Layer.Error<typeof TestLayer>>;
	let tmpRoot: string;
	const createVitestMock = vi.fn();
	const loadMock = vi.fn();
	const originalLoad = vitestLoader.load;
	const originalResolve = vitestLoader.resolveEntry;

	beforeEach(() => {
		runtime = ManagedRuntime.make(TestLayer);
		tmpRoot = mkdtempSync(join(tmpdir(), "va-run-tests-stale-"));
		createVitestMock.mockReset();
		loadMock.mockReset();
		loadMock.mockResolvedValue({ createVitest: createVitestMock });
		createVitestMock.mockResolvedValue({
			start: vi.fn(async () => ({ testModules: [], unhandledErrors: [] })),
			state: { getFiles: () => [] },
			close: vi.fn(async () => undefined),
		});
		vitestLoader.load = loadMock as unknown as typeof vitestLoader.load;
	});

	afterEach(async () => {
		await runtime.dispose();
		rmSync(tmpRoot, { recursive: true, force: true });
		vitestLoader.load = originalLoad;
		vitestLoader.resolveEntry = originalResolve;
	});

	const run = () =>
		makeToolCaller(runtime, McpSession.layerTest({ cwd: tmpRoot }))("run_tests", { passWithNoTests: true });

	it("should return an error naming the missing path and the restart remedy without loading vitest when the entry is gone", async () => {
		const missing = join(tmpRoot, "node_modules", ".pnpm", "vitest@gone", "node_modules", "vitest", "dist", "node.js");
		vitestLoader.resolveEntry = () => pathToFileURL(missing).href;

		const result = await run();

		expect(result.kind).toBe("error");
		if (result.kind !== "error") return;
		expect(result.message).toContain(missing);
		expect(result.message).toContain("/mcp");
		expect(result.message).toMatch(/restart/i);
		expect(loadMock).not.toHaveBeenCalled();
		expect(createVitestMock).not.toHaveBeenCalled();
	});

	it("should still load vitest when the resolved entry exists on disk", async () => {
		const present = join(tmpRoot, "node.js");
		writeFileSync(present, "export {};\n");
		const entry = pathToFileURL(present).href;
		vitestLoader.resolveEntry = () => entry;

		const result = await run();

		expect(loadMock).toHaveBeenCalledWith(entry);
		expect(result.kind).not.toBe("error");
	});

	it("should skip the check for the bare vitest/node fallback specifier", async () => {
		vitestLoader.resolveEntry = () => "vitest/node";

		await run();

		expect(loadMock).toHaveBeenCalledWith("vitest/node");
	});
});

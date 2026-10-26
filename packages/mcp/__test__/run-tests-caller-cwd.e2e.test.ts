/**
 * `run_tests` wrong-worktree detection from the hook-injected `_callerCwd`
 * (issue #275). Real temp git repos and `git worktree add` back the
 * same-repo / different-worktree distinction, so this is an e2e file (it
 * spawns git). Refusal and pass-through run through the handler with
 * `vitestLoader.load` substituted (issue #303), so no nested Vitest runs; the
 * wire cases run the real served tool over the in-process stdio harness.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectDiscoveryTest } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpSession } from "../src/session.js";
import { vitestLoader } from "../src/tools/run-tests.js";
import type { ToolParams } from "./utils/caller.js";
import { makeCaller as makeToolCaller } from "./utils/caller.js";
import { makeHarness } from "./utils/harness.js";

const createVitestMock = vi.fn();

const GIT_IDENTITY_ENV = {
	GIT_AUTHOR_NAME: "vitest-agent-test",
	GIT_AUTHOR_EMAIL: "test@vitest-agent.dev",
	GIT_COMMITTER_NAME: "vitest-agent-test",
	GIT_COMMITTER_EMAIL: "test@vitest-agent.dev",
};

function initGitRepo(dir: string): void {
	mkdirSync(dir, { recursive: true });
	execFileSync("git", ["init", "--quiet"], { cwd: dir });
	execFileSync("git", ["commit", "--allow-empty", "--quiet", "-m", "init"], {
		cwd: dir,
		env: { ...process.env, ...GIT_IDENTITY_ENV },
	});
	writeFileSync(join(dir, "vitest.config.ts"), "export default {};\n");
}

function addWorktree(main: string, worktree: string): void {
	execFileSync("git", ["worktree", "add", "--quiet", worktree], { cwd: main, stdio: "pipe" });
	writeFileSync(join(worktree, "vitest.config.ts"), "export default {};\n");
}

const fakeVitest = () => ({
	start: vi.fn(async () => ({ testModules: [], unhandledErrors: [] })),
	state: { getFiles: () => [] },
	close: vi.fn(async () => undefined),
});

const TestLayer = Layer.mergeAll(DataStoreTestLayer, ProjectDiscoveryTest.layer([]));

describe("run_tests _callerCwd worktree detection (e2e)", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Layer.Success<typeof TestLayer>, Layer.Error<typeof TestLayer>>;
	let tmpRoot: string;
	let main: string;
	let sibling: string;
	const originalVitestLoad = vitestLoader.load;

	beforeEach(() => {
		runtime = ManagedRuntime.make(TestLayer);
		// realpath: macOS tmpdir is a symlink (/var -> /private/var).
		tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "va-run-tests-caller-cwd-")));
		main = join(tmpRoot, "main");
		sibling = join(tmpRoot, "main-wt");
		initGitRepo(main);
		addWorktree(main, sibling);
		createVitestMock.mockReset();
		createVitestMock.mockResolvedValue(fakeVitest());
		vitestLoader.load = (async () => ({
			createVitest: (...a: unknown[]) => createVitestMock(...a),
		})) as unknown as typeof vitestLoader.load;
	});

	afterEach(async () => {
		await runtime.dispose();
		rmSync(tmpRoot, { recursive: true, force: true });
		vitestLoader.load = originalVitestLoad;
	});

	const call = (cwd: string, params: ToolParams<"run_tests">) =>
		makeToolCaller(runtime, McpSession.layerTest({ cwd }))("run_tests", params);

	it("should refuse a caller in a sibling worktree, naming both trees, without starting Vitest", async () => {
		const result = await call(main, { _callerCwd: sibling });
		expect(result.kind).toBe("error");
		if (result.kind !== "error") return;
		expect(result.message).toContain(main);
		expect(result.message).toContain(sibling);
		expect(result.message).toContain("projectRoot");
		expect(createVitestMock).not.toHaveBeenCalled();
	});

	it("should run in the caller's worktree when it passes it as projectRoot", async () => {
		const result = await call(main, { _callerCwd: sibling, projectRoot: sibling });
		expect(result.kind).toBe("ok");
		const [options] = createVitestMock.mock.calls[0] as [{ root: string }];
		expect(options.root).toBe(sibling);
	});

	it("should refuse when the explicit projectRoot is the other worktree than the caller's", async () => {
		const result = await call(sibling, { _callerCwd: sibling, projectRoot: main });
		expect(result.kind).toBe("error");
		expect(createVitestMock).not.toHaveBeenCalled();
	});

	it("should proceed when the caller is a subdirectory of the same tree", async () => {
		const sub = join(main, "packages", "sdk");
		mkdirSync(sub, { recursive: true });
		const result = await call(main, { _callerCwd: sub });
		expect(result.kind).toBe("ok");
	});

	it("should proceed when _callerCwd is empty", async () => {
		const result = await call(main, { _callerCwd: "" });
		expect(result.kind).toBe("ok");
	});

	it("should proceed when _callerCwd does not exist", async () => {
		const result = await call(main, { _callerCwd: join(tmpRoot, "missing") });
		expect(result.kind).toBe("ok");
	});

	it("should proceed when _callerCwd is a file, not a directory", async () => {
		const result = await call(main, { _callerCwd: join(main, "vitest.config.ts") });
		expect(result.kind).toBe("ok");
	});

	it("should proceed when _callerCwd is outside any git repository", async () => {
		const plain = join(tmpRoot, "plain");
		mkdirSync(plain);
		const result = await call(main, { _callerCwd: plain });
		expect(result.kind).toBe("ok");
	});

	it("should proceed when _callerCwd is a different repository", async () => {
		const other = join(tmpRoot, "other");
		initGitRepo(other);
		const result = await call(main, { _callerCwd: other });
		expect(result.kind).toBe("ok");
	});

	it("should proceed when _callerCwd is absent", async () => {
		const result = await call(main, {});
		expect(result.kind).toBe("ok");
	});

	describe("through the served tool", () => {
		const wire = (cwd: string, args: unknown) =>
			Effect.runPromise(
				Effect.scoped(
					Effect.flatMap(makeHarness({ session: McpSession.layerTest({ cwd }) }), (h) =>
						h.initialize().pipe(Effect.andThen(h.callTool("run_tests", args))),
					),
				),
			) as Promise<{
				isError?: boolean;
				structuredContent?: { kind: string; message: string };
				content: Array<{ text?: string }>;
			}>;

		it("should accept _callerCwd as a served param and refuse a worktree mismatch", async () => {
			const result = await wire(main, { _callerCwd: sibling });
			expect(result.isError).toBe(false);
			expect(result.structuredContent?.kind).toBe("error");
			expect(result.structuredContent?.message).toContain(sibling);
		});

		it("should still reject an unknown key", async () => {
			const result = await wire(main, { _callerCwd: sibling, _bogus: true });
			expect(result.isError).toBe(true);
			expect(JSON.stringify(result.content)).toContain("_bogus");
		});
	});
});

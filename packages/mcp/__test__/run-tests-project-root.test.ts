/**
 * `run_tests`'s optional `projectRoot` param (issue #252). The MCP server is
 * a long-lived process that freezes its root at boot (`ctx.cwd`); from a git
 * worktree of the same repo it silently runs against the OTHER tree and
 * reports those results as the caller's. `projectRoot`, when supplied, must
 * be validated (existing directory, same repository as `ctx.cwd` via
 * `git rev-parse --git-common-dir`) before it is used as the Vitest `root` —
 * never trusted blindly, never silently falling back to `ctx.cwd`.
 *
 * Seam: `vitest/node`'s `createVitest` is intercepted via `vi.mock` so these
 * tests never actually spin up a nested Vitest run — they assert on what
 * root argument `createVitest` was called with (or that it was not called
 * at all for the rejection cases). Real temp git repos (via `git init` /
 * `git worktree add`) back the same-repo / different-repo distinction so a
 * mutant that fakes the git-common-dir comparison cannot pass.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { DataStoreTestLayer } from "@vitest-agent/sdk/testing";
import { Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";

const createVitestMock = vi.fn();

vi.mock("vitest/node", () => ({
	createVitest: (...args: unknown[]) => createVitestMock(...args),
}));

// Imported after the mock is declared — vi.mock is hoisted by Vitest, but
// keeping the import below the mock makes the ordering explicit for readers.
const { appRouter } = await import("../src/router.js");

const GIT_IDENTITY_ENV = {
	GIT_AUTHOR_NAME: "vitest-agent-test",
	GIT_AUTHOR_EMAIL: "test@vitest-agent.dev",
	GIT_COMMITTER_NAME: "vitest-agent-test",
	GIT_COMMITTER_EMAIL: "test@vitest-agent.dev",
};

function initGitRepo(dir: string): void {
	execFileSync("git", ["init", "--quiet"], { cwd: dir });
	execFileSync("git", ["commit", "--allow-empty", "--quiet", "-m", "init"], {
		cwd: dir,
		env: { ...process.env, ...GIT_IDENTITY_ENV },
	});
}

function fakeVitest() {
	return {
		start: vi.fn(async () => ({ testModules: [], unhandledErrors: [] })),
		state: { getFiles: () => [] },
		close: vi.fn(async () => undefined),
	};
}

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));

describe("run_tests projectRoot validation", () => {
	let runtime: ManagedRuntime.ManagedRuntime<never, never>;
	let tmpRoot: string;

	beforeEach(() => {
		runtime = ManagedRuntime.make(TestLayer) as unknown as ManagedRuntime.ManagedRuntime<never, never>;
		tmpRoot = mkdtempSync(join(tmpdir(), "va-run-tests-project-root-"));
		createVitestMock.mockReset();
	});

	afterEach(async () => {
		await runtime.dispose();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	const makeCaller = (cwd: string) =>
		createCallerFactory(appRouter)({
			runtime: runtime as unknown as McpContext["runtime"],
			cwd,
			currentSessionId: createCurrentSessionIdRef(null),
			sessionContext: createSessionContextRef(),
		});

	it("rejects a projectRoot belonging to an unrelated git repository, naming both paths, without starting Vitest", async () => {
		const repoA = join(tmpRoot, "repo-a");
		const repoB = join(tmpRoot, "repo-b");
		execFileSync("mkdir", [repoA]);
		execFileSync("mkdir", [repoB]);
		initGitRepo(repoA);
		initGitRepo(repoB);

		createVitestMock.mockResolvedValue(fakeVitest());

		const caller = makeCaller(repoA);
		const result = await caller.run_tests({ projectRoot: repoB });

		expect(result.kind).toBe("error");
		if (result.kind !== "error") return;
		expect(result.message).toContain(repoA);
		expect(result.message).toContain(repoB);
		expect(createVitestMock).not.toHaveBeenCalled();
	});

	it("rejects a projectRoot path that does not exist, without starting Vitest", async () => {
		const repoA = join(tmpRoot, "repo-a");
		execFileSync("mkdir", [repoA]);
		initGitRepo(repoA);
		const missing = join(tmpRoot, "does-not-exist");

		createVitestMock.mockResolvedValue(fakeVitest());

		const caller = makeCaller(repoA);
		const result = await caller.run_tests({ projectRoot: missing });

		expect(result.kind).toBe("error");
		if (result.kind !== "error") return;
		expect(result.message).toContain(missing);
		expect(createVitestMock).not.toHaveBeenCalled();
	});

	it("starts Vitest with the supplied projectRoot when it is a genuine sibling worktree of the same repo", async () => {
		const main = join(tmpRoot, "main");
		execFileSync("mkdir", [main]);
		initGitRepo(main);
		const worktree = join(tmpRoot, "main-wt");
		execFileSync("git", ["worktree", "add", worktree], { cwd: main });

		const vitest = fakeVitest();
		createVitestMock.mockResolvedValue(vitest);

		// The server's frozen boot root is `main`; the caller passes the
		// sibling worktree as projectRoot — Vitest must start against
		// THAT root, not the frozen one.
		const caller = makeCaller(main);
		const result = await caller.run_tests({ projectRoot: worktree });

		expect(result.kind).toBe("ok");
		expect(createVitestMock).toHaveBeenCalledTimes(1);
		const [, options] = createVitestMock.mock.calls[0] as [string, { root: string }];
		expect(options.root).toBe(worktree);
	});

	it("echoes ctx.cwd as the resolved projectRoot when none was supplied", async () => {
		const main = join(tmpRoot, "main");
		execFileSync("mkdir", [main]);
		initGitRepo(main);
		createVitestMock.mockResolvedValue(fakeVitest());

		const caller = makeCaller(main);
		const result = await caller.run_tests({});

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.projectRoot).toBe(main);
	});

	it("echoes the real supplied+validated projectRoot, not a hardcoded ctx.cwd", async () => {
		const main = join(tmpRoot, "main");
		execFileSync("mkdir", [main]);
		initGitRepo(main);
		const worktree = join(tmpRoot, "main-wt");
		execFileSync("git", ["worktree", "add", worktree], { cwd: main });
		createVitestMock.mockResolvedValue(fakeVitest());

		const caller = makeCaller(main);
		const result = await caller.run_tests({ projectRoot: worktree });

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		// A mutant that always echoes ctx.cwd (`main`) while actually running
		// against the worktree must fail this assertion.
		expect(result.projectRoot).toBe(worktree);
		expect(result.projectRoot).not.toBe(main);
	});

	it("echoes the resolved projectRoot on a no-match result", async () => {
		const main = join(tmpRoot, "main");
		execFileSync("mkdir", [main]);
		initGitRepo(main);
		const worktree = join(tmpRoot, "main-wt");
		execFileSync("git", ["worktree", "add", worktree], { cwd: main });
		createVitestMock.mockResolvedValue(fakeVitest());

		const caller = makeCaller(main);
		const result = await caller.run_tests({ projectRoot: worktree, files: ["nowhere.test.ts"] });

		expect(result.kind).toBe("no-match");
		if (result.kind !== "no-match") return;
		expect(result.projectRoot).toBe(worktree);
	});
});

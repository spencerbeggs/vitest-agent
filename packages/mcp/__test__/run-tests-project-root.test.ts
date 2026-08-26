/**
 * `run_tests`'s optional `projectRoot` param (issue #252). The MCP server is
 * a long-lived process that freezes its root at boot (`ctx.cwd`); from a git
 * worktree of the same repo it silently runs against the OTHER tree and
 * reports those results as the caller's. `projectRoot`, when supplied, must
 * be validated (existing directory, same repository as `ctx.cwd` via
 * `git rev-parse --git-common-dir`) before it is used as the Vitest `root` —
 * never trusted blindly, never silently falling back to `ctx.cwd`.
 *
 * Seam: `vitest/node`'s `createVitest` is intercepted by substituting
 * `vitestLoader.load` (packages/mcp/src/tools/run-tests.ts) so these tests
 * never actually spin up a nested Vitest run — they assert on what root
 * argument `createVitest` was called with (or that it was not called at all
 * for the rejection cases). `vi.mock("vitest/node", ...)` does NOT work here
 * (issue #303): the production code now resolves the import specifier via
 * `resolveVitestNodeEntry`, a computed value, and vitest's own vite-node
 * only special-cases AST-literal `import("vitest/node")` call sites for mock
 * interception — a computed specifier silently bypasses that and loads the
 * real module. `vitestLoader` is a plain mutable object; tests reassign its
 * `.load` property directly instead. Real temp git repos (via `git init` /
 * `git worktree add`) back the same-repo / different-repo distinction so a
 * mutant that fakes the git-common-dir comparison cannot pass.
 *
 * Issue #259: an unsupplied `projectRoot` no longer echoes `ctx.cwd`
 * verbatim — it anchors at `resolveConfigAnchoredRoot(ctx.cwd)` (see the
 * dedicated `resolve-config-anchored-root.test.ts` for the helper's own
 * unit coverage). The two `issue #259:`-prefixed cases below cover the
 * integration seam this file owns: an explicit, validated `projectRoot`
 * is returned VERBATIM (no anchoring — explicit is explicit), while
 * `undefined` is anchored.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { DataStoreTestLayer } from "@vitest-agent/sdk/testing";
import { Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { vitestLoader } from "../src/tools/run-tests.js";

const createVitestMock = vi.fn();

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

	const originalVitestLoad = vitestLoader.load;

	beforeEach(() => {
		runtime = ManagedRuntime.make(TestLayer) as unknown as ManagedRuntime.ManagedRuntime<never, never>;
		tmpRoot = mkdtempSync(join(tmpdir(), "va-run-tests-project-root-"));
		createVitestMock.mockReset();
		// Issue #303: substitute the loader directly rather than `vi.mock`ing
		// "vitest/node" — see the file-level comment above.
		vitestLoader.load = (async () => ({
			createVitest: (...innerArgs: unknown[]) => createVitestMock(...innerArgs),
		})) as unknown as typeof vitestLoader.load;
	});

	afterEach(async () => {
		await runtime.dispose();
		rmSync(tmpRoot, { recursive: true, force: true });
		vitestLoader.load = originalVitestLoad;
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

	it("resolves a relative projectRoot against ctx.cwd, not the server process's cwd", async () => {
		const main = join(tmpRoot, "main");
		execFileSync("mkdir", [main]);
		initGitRepo(main);
		const nested = join(main, "pkg");
		execFileSync("mkdir", [nested]);

		const vitest = fakeVitest();
		createVitestMock.mockResolvedValue(vitest);

		// A bare `resolve("pkg")` would use the MCP server process's cwd —
		// this repository's own checkout under test — as the base, which is
		// a base the caller never chose and cannot see. It must resolve
		// against ctx.cwd instead.
		const caller = makeCaller(main);
		const result = await caller.run_tests({ projectRoot: "pkg" });

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.projectRoot).toBe(nested);
		const [, options] = createVitestMock.mock.calls[0] as [string, { root: string }];
		expect(options.root).toBe(nested);
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

	it("issue #259: anchors an unsupplied projectRoot at the ancestor dir holding the vitest config, not ctx.cwd verbatim", async () => {
		const main = join(tmpRoot, "main");
		execFileSync("mkdir", [main]);
		initGitRepo(main);
		writeFileSync(join(main, "vitest.config.ts"), "export default {};\n");
		const pkgDir = join(main, "packages", "foo");
		mkdirSync(pkgDir, { recursive: true });

		createVitestMock.mockResolvedValue(fakeVitest());

		// ctx.cwd (the server's frozen boot dir) is the package subtree —
		// the discriminating shape from issue #259. Undefined projectRoot
		// must anchor UP to `main` (where vitest.config.ts lives), not stay
		// pinned at the subtree the old pass-through behavior returned.
		const caller = makeCaller(pkgDir);
		const result = await caller.run_tests({});

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.projectRoot).toBe(main);
		const [, options] = createVitestMock.mock.calls[0] as [string, { root: string }];
		expect(options.root).toBe(main);
	});

	it("issue #259: an explicit, valid projectRoot pointing at a subtree is returned verbatim -- NOT anchored", async () => {
		const main = join(tmpRoot, "main");
		execFileSync("mkdir", [main]);
		initGitRepo(main);
		writeFileSync(join(main, "vitest.config.ts"), "export default {};\n");
		const pkgDir = join(main, "packages", "foo");
		mkdirSync(pkgDir, { recursive: true });

		createVitestMock.mockResolvedValue(fakeVitest());

		// ctx.cwd is `main` (so the anchor helper would find `main`'s own
		// config immediately if it ran) but the caller explicitly asks for
		// the subtree -- explicit is explicit, anchoring must NOT override it.
		const caller = makeCaller(main);
		const result = await caller.run_tests({ projectRoot: pkgDir });

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.projectRoot).toBe(pkgDir);
		const [, options] = createVitestMock.mock.calls[0] as [string, { root: string }];
		expect(options.root).toBe(pkgDir);
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

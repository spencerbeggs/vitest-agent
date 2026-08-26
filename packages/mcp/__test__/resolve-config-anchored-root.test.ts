/**
 * Issue #259: Vitest resolves the CONFIG FILE by walking UP from `root`, but
 * resolves that config's relative `globalSetup` / `setupFiles` entries
 * DOWNWARD from `resolved.root` (vitest@4.1.11:
 * `resolved.globalSetup = toArray(...).map((file) => resolvePath(file, resolved.root))`).
 * `run_tests` passes the MCP server's boot dir straight through as Vitest's
 * `root`. When that boot dir is a package subtree of a monorepo, Vitest
 * still walks up and loads `<repo>/vitest.config.ts`, but resolves that
 * config's relative `globalSetup: ["vitest.setup.ts"]` against the subtree —
 * producing `<repo>/packages/<pkg>/vitest.setup.ts`, which does not exist.
 *
 * `resolveConfigAnchoredRoot(startDir)` fixes this by walking UP from
 * `startDir` looking for the config Vitest would load anyway, and returning
 * THAT directory as the root — so root and config-dir can no longer
 * disagree. Bounded at the git root so an unrelated `vite.config.ts` above
 * the repo can't capture the root; never throws — a bad/unreadable path
 * degrades to today's behavior (return `startDir` unchanged).
 *
 * Seam: real tmpdir fixtures via `mkdtempSync` — this helper `stat`s the
 * real filesystem, so memfs will not work. macOS `/tmp` is a symlink to
 * `/private/tmp`; compare through `realpathSync` like
 * `resolve-vitest-node-entry.test.ts` does.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfigAnchoredRoot } from "../src/tools/run-tests.js";

describe("resolveConfigAnchoredRoot", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "va-resolve-config-anchored-root-")));
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("anchors from a package subtree with no local config up to the ancestor dir holding vitest.config.ts (issue #259 bug case)", () => {
		mkdirSync(join(tmpRoot, ".git"));
		writeFileSync(join(tmpRoot, "vitest.config.ts"), "export default {};\n");
		const pkgDir = join(tmpRoot, "packages", "foo");
		mkdirSync(pkgDir, { recursive: true });

		const result = resolveConfigAnchoredRoot(pkgDir);

		expect(result).toBe(tmpRoot);
	});

	it("returns the directory unchanged when startDir already holds the vitest config", () => {
		mkdirSync(join(tmpRoot, ".git"));
		writeFileSync(join(tmpRoot, "vitest.config.ts"), "export default {};\n");

		const result = resolveConfigAnchoredRoot(tmpRoot);

		expect(result).toBe(tmpRoot);
	});

	it("prefers the nearest config: a package with its own vitest.config.ts keeps its own root instead of the repo root's", () => {
		mkdirSync(join(tmpRoot, ".git"));
		writeFileSync(join(tmpRoot, "vitest.config.ts"), "export default {};\n");
		const pkgDir = join(tmpRoot, "packages", "foo");
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(join(pkgDir, "vitest.config.ts"), "export default {};\n");

		const result = resolveConfigAnchoredRoot(pkgDir);

		expect(result).toBe(pkgDir);
		expect(result).not.toBe(tmpRoot);
	});

	it("bounds the walk at the git root: a config sitting above the git root is never returned", () => {
		writeFileSync(join(tmpRoot, "vitest.config.ts"), "export default {};\n");
		const repoDir = join(tmpRoot, "repo");
		mkdirSync(join(repoDir, ".git"), { recursive: true });
		const pkgDir = join(repoDir, "packages", "foo");
		mkdirSync(pkgDir, { recursive: true });

		const result = resolveConfigAnchoredRoot(pkgDir);

		expect(result).toBe(pkgDir);
	});

	it("bounds the walk at a worktree's .git FILE (not directory) the same as a .git directory", () => {
		writeFileSync(join(tmpRoot, "vitest.config.ts"), "export default {};\n");
		const repoDir = join(tmpRoot, "repo");
		mkdirSync(repoDir, { recursive: true });
		// A linked worktree's `.git` is a FILE containing a `gitdir:` pointer,
		// not a directory — `existsSync` must accept either shape.
		writeFileSync(join(repoDir, ".git"), "gitdir: /elsewhere/.git/worktrees/repo\n");
		const pkgDir = join(repoDir, "packages", "foo");
		mkdirSync(pkgDir, { recursive: true });

		const result = resolveConfigAnchoredRoot(pkgDir);

		expect(result).toBe(pkgDir);
	});

	it("returns startDir unchanged, without throwing, when no vitest/vite config exists anywhere in range", () => {
		// No .git marker and no config anywhere under tmpRoot — a genuinely
		// unrelated tree, distinct from "found nothing before the git
		// boundary" (behavior 6/7 above).
		const pkgDir = join(tmpRoot, "packages", "foo");
		mkdirSync(pkgDir, { recursive: true });

		expect(() => resolveConfigAnchoredRoot(pkgDir)).not.toThrow();
		expect(resolveConfigAnchoredRoot(pkgDir)).toBe(pkgDir);
	});

	it("finds a non-.ts vitest config (vitest.config.mjs)", () => {
		mkdirSync(join(tmpRoot, ".git"));
		writeFileSync(join(tmpRoot, "vitest.config.mjs"), "export default {};\n");
		const pkgDir = join(tmpRoot, "packages", "foo");
		mkdirSync(pkgDir, { recursive: true });

		const result = resolveConfigAnchoredRoot(pkgDir);

		expect(result).toBe(tmpRoot);
	});

	it("falls back to vite.config.ts when no vitest.config.* exists in that directory", () => {
		mkdirSync(join(tmpRoot, ".git"));
		writeFileSync(join(tmpRoot, "vite.config.ts"), "export default {};\n");
		const pkgDir = join(tmpRoot, "packages", "foo");
		mkdirSync(pkgDir, { recursive: true });

		const result = resolveConfigAnchoredRoot(pkgDir);

		expect(result).toBe(tmpRoot);
	});
});

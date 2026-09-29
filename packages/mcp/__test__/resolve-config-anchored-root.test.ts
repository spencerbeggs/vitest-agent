/**
 * Issue #259: Vitest 5 probes ONLY the given `root` for a config file, and
 * resolves that config's relative `globalSetup` / `setupFiles` against the
 * root. `run_tests` therefore anchors its root at the directory holding the
 * config Vitest would load anyway: `resolveConfigAnchoredRoot(startDir)`
 * walks UP from `startDir` for `vitest.config.*` / `vite.config.*` and
 * yields THAT directory; `resolveAnchoredConfigFile(startDir)` yields the
 * config path from the same walk (the explicit-`projectRoot` path passes it
 * as `config:`). Bounded at the git work-tree root `Git.repoRoot` reports
 * (a linked worktree reports its own root), so an unrelated config above
 * the repo can't capture the root; outside a repository the walk runs to
 * the filesystem root. Never fails.
 *
 * Seam (issues #384 / #389): both helpers run on `@effected/walker` and
 * `@effected/git` over injected services, so every guard case below
 * declares its own layout in an `@effected/memfs` volume and its own git
 * answer through `Git.layerTest`, instead of leaning on a real tmpdir (whose
 * ancestors are the host's) or this repository's layout. One smoke test
 * runs against the real tree, because anchoring to a real config is the
 * point of the helper.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { Git, NotARepositoryError } from "@effected/git";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem } from "effect";
import { Effect, Layer, Path } from "effect";
import { describe, expect, it } from "vitest";
import { resolveAnchoredConfigFile, resolveConfigAnchoredRoot } from "../src/tools/run-tests.js";

/** `repoRoot` answers `root` for every cwd — the work-tree root git would report. */
const inRepo = (root: string) => Git.layerTest({ repoRoot: () => Effect.succeed(root) });
/** `repoRoot` fails the way live git does outside a work tree. */
const noRepo = Git.layerTest({ repoRoot: (cwd) => Effect.fail(new NotARepositoryError({ cwd })) });

/** Run a walk against a volume holding exactly `seed` — nothing outside it exists — and a `Git` double. */
const onVolume = <A>(
	seed: MemoryFileSystemSeed,
	git: Layer.Layer<Git>,
	effect: Effect.Effect<A, never, FileSystem.FileSystem | Path.Path | Git>,
): Promise<A> =>
	Effect.runPromise(Effect.provide(effect, Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer, git)));

const CONFIG = "export default {};\n";
const dir = MemoryFileSystem.directory();

describe("resolveConfigAnchoredRoot", () => {
	it("anchors from a package subtree with no local config up to the ancestor holding vitest.config.ts (issue #259)", async () => {
		const seed = { "/repo/vitest.config.ts": CONFIG, "/repo/packages/foo": dir };
		expect(await onVolume(seed, inRepo("/repo"), resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo");
	});

	it("examines the git root itself before stopping (the ceiling is inclusive)", async () => {
		const seed = { "/repo/vite.config.cjs": CONFIG, "/repo/a/b/c": dir };
		expect(await onVolume(seed, inRepo("/repo"), resolveConfigAnchoredRoot("/repo/a/b/c"))).toBe("/repo");
	});

	it("returns startDir unchanged when it already holds the config", async () => {
		const seed = { "/repo/vitest.config.ts": CONFIG };
		expect(await onVolume(seed, inRepo("/repo"), resolveConfigAnchoredRoot("/repo"))).toBe("/repo");
	});

	it("prefers the nearest config: a package with its own config keeps its own root", async () => {
		const seed = { "/repo/vitest.config.ts": CONFIG, "/repo/packages/foo/vitest.config.ts": CONFIG };
		const root = await onVolume(seed, inRepo("/repo"), resolveConfigAnchoredRoot("/repo/packages/foo"));
		expect(root).toBe("/repo/packages/foo");
	});

	it("bounds the walk at the git root: a config above the repository is never returned", async () => {
		const seed = { "/vitest.config.ts": CONFIG, "/repo/packages/foo": dir };
		const root = await onVolume(seed, inRepo("/repo"), resolveConfigAnchoredRoot("/repo/packages/foo"));
		expect(root).toBe("/repo/packages/foo");
	});

	it("bounds a linked worktree at its own root, not the main checkout's", async () => {
		// git answers a worktree's own top level; a config beside the main
		// checkout's parent must not capture the worktree.
		const seed = { "/work/vitest.config.ts": CONFIG, "/work/wt/packages/foo": dir, "/work/main": dir };
		const root = await onVolume(seed, inRepo("/work/wt"), resolveConfigAnchoredRoot("/work/wt/packages/foo"));
		expect(root).toBe("/work/wt/packages/foo");
	});

	it("walks to the filesystem root outside a repository", async () => {
		// Control for the bound cases above: with no work tree, the same layout
		// DOES reach the config at the volume root.
		const seed = { "/vitest.config.ts": CONFIG, "/repo/packages/foo": dir };
		expect(await onVolume(seed, noRepo, resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/");
	});

	it("bounds at the lexical ancestor when git reports the root as a physical (symlink-resolved) path", async () => {
		// `/link` -> `/real`: git reports `/real/repo`, the walk ascends
		// `/link/repo/...`. A raw `stopAt: "/real/repo"` matches nothing and
		// the walk would reach `/vitest.config.ts`.
		const seed = {
			"/vitest.config.ts": CONFIG,
			"/real/repo/packages/foo": dir,
			"/link": MemoryFileSystem.symlink("/real"),
		};
		const root = await onVolume(seed, inRepo("/real/repo"), resolveConfigAnchoredRoot("/link/repo/packages/foo"));
		expect(root).toBe("/link/repo/packages/foo");
	});

	it("returns startDir unchanged when no config exists anywhere in range", async () => {
		const seed = { "/repo/packages/foo": dir };
		expect(await onVolume(seed, noRepo, resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo/packages/foo");
	});

	it("returns startDir unchanged, never failing, when the walk dies", async () => {
		// `Git.layerTest({})` leaves `repoRoot` unstubbed, which dies.
		const seed = { "/repo/vitest.config.ts": CONFIG, "/repo/packages/foo": dir };
		const root = await onVolume(seed, Git.layerTest({}), resolveConfigAnchoredRoot("/repo/packages/foo"));
		expect(root).toBe("/repo/packages/foo");
	});

	it("finds a non-.ts vitest config (vitest.config.mjs)", async () => {
		const seed = { "/repo/vitest.config.mjs": CONFIG, "/repo/packages/foo": dir };
		expect(await onVolume(seed, inRepo("/repo"), resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo");
	});

	it("falls back to vite.config.ts when no vitest.config.* exists", async () => {
		const seed = { "/repo/vite.config.ts": CONFIG, "/repo/packages/foo": dir };
		expect(await onVolume(seed, inRepo("/repo"), resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo");
	});
});

describe("resolveAnchoredConfigFile", () => {
	it("returns the config path when it sits in startDir", async () => {
		const seed = { "/repo/vitest.config.ts": CONFIG };
		expect(await onVolume(seed, inRepo("/repo"), resolveAnchoredConfigFile("/repo"))).toBe("/repo/vitest.config.ts");
	});

	it("walks up to an ancestor's config", async () => {
		const seed = { "/repo/vitest.config.ts": CONFIG, "/repo/packages/foo": dir };
		const file = await onVolume(seed, inRepo("/repo"), resolveAnchoredConfigFile("/repo/packages/foo"));
		expect(file).toBe("/repo/vitest.config.ts");
	});

	it("prefers a vitest config over a vite config in the same directory", async () => {
		const seed = { "/repo/vite.config.ts": CONFIG, "/repo/vitest.config.cjs": CONFIG };
		expect(await onVolume(seed, inRepo("/repo"), resolveAnchoredConfigFile("/repo"))).toBe("/repo/vitest.config.cjs");
	});

	it("prefers extensions in ts, mts, cts, js, mjs, cjs order", async () => {
		const seed = { "/repo/vitest.config.js": CONFIG, "/repo/vitest.config.mts": CONFIG };
		expect(await onVolume(seed, inRepo("/repo"), resolveAnchoredConfigFile("/repo"))).toBe("/repo/vitest.config.mts");
	});

	it("prefers a nearer vite config over a farther vitest config", async () => {
		const seed = { "/repo/vitest.config.ts": CONFIG, "/repo/pkg/vite.config.ts": CONFIG };
		const file = await onVolume(seed, inRepo("/repo"), resolveAnchoredConfigFile("/repo/pkg"));
		expect(file).toBe("/repo/pkg/vite.config.ts");
	});

	it("returns null when no config exists within the git boundary", async () => {
		const seed = { "/vitest.config.ts": CONFIG, "/repo/packages/foo": dir };
		expect(await onVolume(seed, inRepo("/repo"), resolveAnchoredConfigFile("/repo/packages/foo"))).toBeNull();
	});

	it("returns null when no config exists anywhere", async () => {
		const file = await onVolume({ "/repo/packages/foo": dir }, noRepo, resolveAnchoredConfigFile("/repo/packages/foo"));
		expect(file).toBeNull();
	});

	it("returns null, never failing, when the walk dies", async () => {
		const seed = { "/repo/vitest.config.ts": CONFIG };
		expect(await onVolume(seed, Git.layerTest({}), resolveAnchoredConfigFile("/repo"))).toBeNull();
	});

	it("agrees with resolveConfigAnchoredRoot: the root is the directory holding the file (issue #384)", async () => {
		const seed = { "/repo/vite.config.mjs": CONFIG, "/repo/packages/foo/src": dir };
		const file = await onVolume(seed, inRepo("/repo"), resolveAnchoredConfigFile("/repo/packages/foo/src"));
		expect(file).toBe("/repo/vite.config.mjs");
		const root = await onVolume(seed, inRepo("/repo"), resolveConfigAnchoredRoot("/repo/packages/foo/src"));
		expect(root).toBe(dirname(file as string));
	});
});

describe("config anchoring against the real tree (smoke)", () => {
	it("anchors this package's directory at an ancestor that really holds a vitest/vite config", async () => {
		const packageDir = join(import.meta.dirname, "..");
		const fsPath = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
		const platform = Git.layer.pipe(Layer.provide(NodeChildProcessSpawner.layer), Layer.provideMerge(fsPath));
		const file = await Effect.runPromise(Effect.provide(resolveAnchoredConfigFile(packageDir), platform));
		expect(file).not.toBeNull();
		expect(existsSync(file as string)).toBe(true);
		expect(packageDir.startsWith(dirname(file as string))).toBe(true);
	});
});

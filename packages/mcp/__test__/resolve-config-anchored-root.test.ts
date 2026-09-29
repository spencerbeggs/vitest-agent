/**
 * Issue #259: Vitest 5 probes ONLY the given `root` for a config file, and
 * resolves that config's relative `globalSetup` / `setupFiles` against the
 * root. `run_tests` therefore anchors its root at the directory holding the
 * config Vitest would load anyway: `resolveConfigAnchoredRoot(startDir)`
 * walks UP from `startDir` for `vitest.config.*` / `vite.config.*` and
 * yields THAT directory; `resolveAnchoredConfigFile(startDir)` yields the
 * config path from the same walk (the explicit-`projectRoot` path passes it
 * as `config:`). Bounded at the git root — a `.git` directory or a linked
 * worktree's `.git` FILE — so an unrelated config above the repo can't
 * capture the root; never fails.
 *
 * Seam (issues #384 / #389): both helpers run on `@effected/walker` over an
 * injected `FileSystem` / `Path`, so every guard case below declares its own
 * layout in an `@effected/memfs` volume instead of leaning on a real tmpdir
 * (whose ancestors are the host's) or this repository's layout. One smoke
 * test runs against the real tree, because anchoring to a real config is
 * the point of the helper.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem } from "effect";
import { Effect, Layer, Path } from "effect";
import { describe, expect, it } from "vitest";
import { resolveAnchoredConfigFile, resolveConfigAnchoredRoot } from "../src/tools/run-tests.js";

/** Run a walk against a volume holding exactly `seed` — nothing outside it exists. */
const onVolume = <A>(
	seed: MemoryFileSystemSeed,
	effect: Effect.Effect<A, never, FileSystem.FileSystem | Path.Path>,
): Promise<A> =>
	Effect.runPromise(Effect.provide(effect, Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer)));

const CONFIG = "export default {};\n";
const dir = MemoryFileSystem.directory();

describe("resolveConfigAnchoredRoot", () => {
	it("anchors from a package subtree with no local config up to the ancestor holding vitest.config.ts (issue #259)", async () => {
		const seed = { "/repo/.git": dir, "/repo/vitest.config.ts": CONFIG, "/repo/packages/foo": dir };
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo");
	});

	it("examines the git root itself before stopping", async () => {
		const seed = { "/repo/.git": dir, "/repo/vite.config.cjs": CONFIG, "/repo/a/b/c": dir };
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/repo/a/b/c"))).toBe("/repo");
	});

	it("returns startDir unchanged when it already holds the config", async () => {
		const seed = { "/repo/.git": dir, "/repo/vitest.config.ts": CONFIG };
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/repo"))).toBe("/repo");
	});

	it("prefers the nearest config: a package with its own config keeps its own root", async () => {
		const seed = {
			"/repo/.git": dir,
			"/repo/vitest.config.ts": CONFIG,
			"/repo/packages/foo/vitest.config.ts": CONFIG,
		};
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo/packages/foo");
	});

	it("bounds the walk at a .git directory: a config above the git root is never returned", async () => {
		const seed = { "/vitest.config.ts": CONFIG, "/repo/.git": dir, "/repo/packages/foo": dir };
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo/packages/foo");
	});

	it("bounds the walk at a worktree's .git FILE the same as a .git directory", async () => {
		const seed = {
			"/vitest.config.ts": CONFIG,
			"/wt/.git": "gitdir: /main/.git/worktrees/wt\n",
			"/wt/packages/foo": dir,
		};
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/wt/packages/foo"))).toBe("/wt/packages/foo");
	});

	it("walks past a directory with no .git marker to reach an ancestor config", async () => {
		// Control for the two bound cases above: without the marker, the
		// same layout DOES reach the config at the volume root.
		const seed = { "/vitest.config.ts": CONFIG, "/wt/packages/foo": dir };
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/wt/packages/foo"))).toBe("/");
	});

	it("returns startDir unchanged when no config exists anywhere in range", async () => {
		const seed = { "/repo/packages/foo": dir };
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo/packages/foo");
	});

	it("finds a non-.ts vitest config (vitest.config.mjs)", async () => {
		const seed = { "/repo/.git": dir, "/repo/vitest.config.mjs": CONFIG, "/repo/packages/foo": dir };
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo");
	});

	it("falls back to vite.config.ts when no vitest.config.* exists", async () => {
		const seed = { "/repo/.git": dir, "/repo/vite.config.ts": CONFIG, "/repo/packages/foo": dir };
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/repo/packages/foo"))).toBe("/repo");
	});
});

describe("resolveAnchoredConfigFile", () => {
	it("returns the config path when it sits in startDir", async () => {
		const seed = { "/repo/.git": dir, "/repo/vitest.config.ts": CONFIG };
		expect(await onVolume(seed, resolveAnchoredConfigFile("/repo"))).toBe("/repo/vitest.config.ts");
	});

	it("walks up to an ancestor's config", async () => {
		const seed = { "/repo/.git": dir, "/repo/vitest.config.ts": CONFIG, "/repo/packages/foo": dir };
		expect(await onVolume(seed, resolveAnchoredConfigFile("/repo/packages/foo"))).toBe("/repo/vitest.config.ts");
	});

	it("prefers a vitest config over a vite config in the same directory", async () => {
		const seed = { "/repo/.git": dir, "/repo/vite.config.ts": CONFIG, "/repo/vitest.config.cjs": CONFIG };
		expect(await onVolume(seed, resolveAnchoredConfigFile("/repo"))).toBe("/repo/vitest.config.cjs");
	});

	it("prefers extensions in ts, mts, cts, js, mjs, cjs order", async () => {
		const seed = { "/repo/.git": dir, "/repo/vitest.config.js": CONFIG, "/repo/vitest.config.mts": CONFIG };
		expect(await onVolume(seed, resolveAnchoredConfigFile("/repo"))).toBe("/repo/vitest.config.mts");
	});

	it("prefers a nearer vite config over a farther vitest config", async () => {
		const seed = { "/repo/.git": dir, "/repo/vitest.config.ts": CONFIG, "/repo/pkg/vite.config.ts": CONFIG };
		expect(await onVolume(seed, resolveAnchoredConfigFile("/repo/pkg"))).toBe("/repo/pkg/vite.config.ts");
	});

	it("returns null when no config exists within the git boundary", async () => {
		const seed = { "/vitest.config.ts": CONFIG, "/repo/.git": dir, "/repo/packages/foo": dir };
		expect(await onVolume(seed, resolveAnchoredConfigFile("/repo/packages/foo"))).toBeNull();
	});

	it("returns null when no config exists anywhere", async () => {
		expect(await onVolume({ "/repo/packages/foo": dir }, resolveAnchoredConfigFile("/repo/packages/foo"))).toBeNull();
	});

	it("agrees with resolveConfigAnchoredRoot: the root is the directory holding the file (issue #384)", async () => {
		const seed = { "/repo/.git": dir, "/repo/vite.config.mjs": CONFIG, "/repo/packages/foo/src": dir };
		const file = await onVolume(seed, resolveAnchoredConfigFile("/repo/packages/foo/src"));
		expect(file).toBe("/repo/vite.config.mjs");
		expect(await onVolume(seed, resolveConfigAnchoredRoot("/repo/packages/foo/src"))).toBe(dirname(file as string));
	});
});

describe("config anchoring against the real tree (smoke)", () => {
	it("anchors this package's directory at an ancestor that really holds a vitest/vite config", async () => {
		const packageDir = join(import.meta.dirname, "..");
		const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
		const file = await Effect.runPromise(Effect.provide(resolveAnchoredConfigFile(packageDir), platform));
		expect(file).not.toBeNull();
		expect(existsSync(file as string)).toBe(true);
		expect(packageDir.startsWith(dirname(file as string))).toBe(true);
	});
});

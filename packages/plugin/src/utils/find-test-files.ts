import { join } from "node:path";
import { GlobPattern } from "@effected/glob";
import type { WalkerSyncOps } from "@effected/walker";
import { descendEntriesSync, descendSync } from "@effected/walker";
import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
import { NON_DISCOVERABLE_DIRS } from "@vitest-agent/sdk";
import { Result } from "effect";

// ── Glob matching ──────────────────────────────────────────────────────────
// `@effected/glob` compiles the full minimatch dialect (globstars, nested
// braces, character classes, extglobs). `dot: true` is the option Vitest
// passes to picomatch for `test.include`, so a file under a dot directory the
// walker reaches is matched here exactly when Vitest would collect it.

const GLOB_OPTIONS = { dot: true } as const;

/** Every file, dot entries included: the pattern the signature walk expands. */
const EVERY_FILE = Result.getOrThrow(GlobPattern.compileResult("**", GLOB_OPTIONS));

/**
 * The walk rules every discovery walk shares, so the test-file walk, the
 * cache-signature walk and the engine's `ProjectDiscoveryLive` see one tree.
 * `NON_DISCOVERABLE_DIRS` is pruned before descending (a fixture
 * `node_modules` must never drag in the pnpm store); symlinked directories
 * are followed under the walker's ancestor-chain cycle guard; an unreadable
 * directory contributes nothing, as the `node:fs` walks this replaced did.
 */
const WALK_RULES = {
	prune: [...NON_DISCOVERABLE_DIRS],
	followSymlinks: true,
	onUnreadable: "skip",
} as const;

// ── findTestFiles ─────────────────────────────────────────────────────────────

/**
 * File walker that returns matched absolute paths.
 *
 * Expands each pattern under `dir` with `@effected/walker`'s `descendSync`
 * over `ops` (default: `nodeWalkerSyncOps`). Skips `node_modules`, `.git`, and
 * `dist` directories, follows symlinked directories (a link loop is cut by
 * the walker's cycle guard), and does not descend past a nested
 * `package.json` boundary (any directory other than `dir` itself that has its
 * own `package.json` is treated as an independent unit — its files belong to
 * a separate discovery pass, not this one). The package-boundary rule applies
 * to every supplied pattern, not just an unanchored `**\/` one — an anchored
 * pattern like `"src/**\/*.test.ts"` will not match a test file under a
 * nested package.json even though the pattern itself never reaches past
 * `src/`. Matches files against the supplied glob patterns relative to `dir`
 * (e.g. `"src/**\/*.test.ts"`); a pattern that fails to compile matches
 * nothing.
 *
 * Returns an empty array if `dir` does not exist or no files match.
 * @param dir - Absolute path to the directory to walk
 * @param patterns - Glob patterns to match against (relative to `dir`)
 * @param ops - The sync filesystem the walk reads through
 * @returns Absolute paths of matched test files, each pattern's matches sorted, deduplicated across patterns
 * @public
 */
export async function findTestFiles(
	dir: string,
	patterns: ReadonlyArray<string>,
	ops: WalkerSyncOps = nodeWalkerSyncOps,
): Promise<ReadonlyArray<string>> {
	const results = new Set<string>();
	for (const source of patterns) {
		const compiled = GlobPattern.compileResult(source, GLOB_OPTIONS);
		if (Result.isFailure(compiled)) continue;
		const matches = descendSync(compiled.success, { cwd: dir, boundaries: ["package.json"], ...WALK_RULES, ...ops });
		// Under "skip" the only failure left is a walk past the walker's depth
		// cap, which a cycle-guarded tree cannot reach without being absurd.
		if (Result.isFailure(matches)) throw matches.failure;
		for (const rel of matches.success) results.add(join(dir, rel));
	}
	return [...results];
}

/**
 * A cheap signature (relative path + mtimeMs pairs, sorted) for every file
 * under `dir`, read from the stats the walk already took — no content reads.
 * Empty when `dir` does not exist, which is still a stable, comparable
 * contribution. The same walk rules as {@link findTestFiles}, minus the
 * package boundary, so a change anywhere under the directory invalidates.
 */
export function directorySignature(dir: string, ops: WalkerSyncOps): string {
	const entries = descendEntriesSync(EVERY_FILE, { cwd: dir, ...WALK_RULES, ...ops });
	if (Result.isFailure(entries)) throw entries.failure;
	return entries.success.map((entry) => `${entry.path}:${entry.info.mtimeMs}`).join("|");
}

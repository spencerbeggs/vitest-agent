import { join, relative } from "node:path";
import { GlobPattern } from "@effected/glob";
import { NON_DISCOVERABLE_DIRS } from "@vitest-agent/sdk";
import { Result } from "effect";
import { toPosixPath } from "./to-posix-path.js";
import type { WalkerEntry, WalkerFileSystem } from "./walker-fs.js";
import { nodeWalkerFs } from "./walker-fs.js";

// ── Glob matching ──────────────────────────────────────────────────────────
// `@effected/glob` compiles the full minimatch dialect (globstars, nested
// braces, character classes, extglobs). `dot: true` is the option Vitest
// passes to picomatch for `test.include`, so a file under a dot directory the
// walker reaches is matched here exactly when Vitest would collect it.

const GLOB_OPTIONS = { dot: true } as const;

/**
 * Compile one pattern to a total predicate. A pattern that fails to compile
 * (a guard trip on an absurd input) matches nothing, as the threshold matcher
 * in `CoverageAnalyzerLive` does.
 */
function compileMatcher(pattern: string): (candidate: string) => boolean {
	const result = GlobPattern.compileResult(pattern, GLOB_OPTIONS);
	if (Result.isFailure(result)) return () => false;
	const compiled = result.success;
	return (candidate) => compiled.matches(candidate);
}

// ── findTestFiles ─────────────────────────────────────────────────────────────

/**
 * Async file walker that returns matched absolute paths.
 *
 * Walks `dir` recursively via `node:fs/promises`. Skips `node_modules`, `.git`,
 * and `dist` directories, and does not descend past a nested `package.json`
 * boundary (any directory other than `dir` itself that has its own
 * `package.json` is treated as an independent unit — its files belong to a
 * separate discovery pass, not this one). The package-boundary rule applies
 * to every supplied pattern, not just an unanchored `**\/` one — an anchored
 * pattern like `"src/**\/*.test.ts"` will not match a test file under a
 * nested package.json even though the pattern itself never reaches past
 * `src/`, because the boundary check runs once per directory, independent of
 * which pattern is being matched. Matches files against the supplied glob
 * patterns relative to `dir` (e.g. `"src/**\/*.test.ts"`).
 *
 * Returns an empty array if `dir` does not exist or no files match.
 * @param dir - Absolute path to the directory to walk
 * @param patterns - Glob patterns to match against (relative to `dir`)
 * @returns Absolute paths of matched test files
 * @public
 */
export async function findTestFiles(
	dir: string,
	patterns: ReadonlyArray<string>,
	fs: WalkerFileSystem = nodeWalkerFs,
): Promise<ReadonlyArray<string>> {
	if (patterns.length === 0) return [];

	const matchers = patterns.map(compileMatcher);
	const results: string[] = [];

	await walkDir(dir, dir, matchers, results, fs);

	return results;
}

async function walkDir(
	root: string,
	dir: string,
	matchers: ReadonlyArray<(candidate: string) => boolean>,
	results: string[],
	fs: WalkerFileSystem,
): Promise<void> {
	// readDirectory carries each child's type alongside its name — half the
	// syscalls of readdir-then-stat-per-entry, which is why the port answers
	// WalkerEntry rather than bare names.
	let entries: ReadonlyArray<WalkerEntry>;
	try {
		entries = await fs.readDirectory(dir);
	} catch {
		return;
	}

	// Package boundary: a directory other than the walk's own root that has
	// its own package.json is an independent unit (another workspace
	// package, or a fixture package deliberately shaped like one) — its test
	// files belong to a separate discovery pass, not this one. Without this,
	// an unanchored `**/` pattern walking from a package that structurally
	// contains other packages (most notably a monorepo root) would reach
	// into sibling packages' test dirs and double-count their test files
	// across two projects' include globs.
	if (dir !== root && entries.some((ent) => ent.isFile() && ent.name === "package.json")) {
		return;
	}

	for (const ent of entries) {
		// Skip designated directories. Shared with the classifier and the
		// cache-signature walk via NON_DISCOVERABLE_DIRS — pruning here, before
		// the recursive call below, is what keeps a symlinked node_modules from
		// dragging in the pnpm store.
		if (NON_DISCOVERABLE_DIRS.has(ent.name)) continue;

		const fullPath = join(dir, ent.name);
		if (ent.isDirectory()) {
			await walkDir(root, fullPath, matchers, results, fs);
		} else if (ent.isFile()) {
			// Compute path relative to root for glob matching. toPosixPath
			// normalizes the comparison string on Windows so the glob's
			// slash-bounded patterns resolve identically across platforms.
			// The returned absolute paths still use join() so callers see
			// platform-native results.
			const rel = toPosixPath(relative(root, fullPath));
			if (matchers.some((matches) => matches(rel))) {
				results.push(fullPath);
			}
		}
	}
}

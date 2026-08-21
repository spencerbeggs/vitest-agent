import { join, relative } from "node:path";
import { NON_DISCOVERABLE_DIRS } from "@vitest-agent/sdk";
import { toPosixPath } from "./to-posix-path.js";
import type { WalkerEntry, WalkerFileSystem } from "./walker-fs.js";
import { nodeWalkerFs } from "./walker-fs.js";

// ── Minimal glob-to-RegExp compiler ──────────────────────────────────────────
// Handles the subset used in this codebase:
//   **     → match any path segment(s)
//   *      → match any characters except /
//   {a,b}  → alternation (brace expansion)
//   .      → literal dot
// Patterns are matched against paths relative to the root directory.

function globToRegex(pattern: string): RegExp {
	// Expand {a,b,c} brace groups into alternation first
	const expanded = expandBraces(pattern);
	// Convert each expanded alternative to a regex fragment, then join with |
	const alts = expanded.map(toRegexFragment);
	return new RegExp(`^(?:${alts.join("|")})$`);
}

/** Expands the FIRST brace group found in a pattern string. Recursive to handle nesting. */
function expandBraces(pattern: string): string[] {
	const open = pattern.indexOf("{");
	if (open === -1) return [pattern];
	const close = pattern.indexOf("}", open);
	if (close === -1) return [pattern];
	const prefix = pattern.slice(0, open);
	const suffix = pattern.slice(close + 1);
	const alternatives = pattern.slice(open + 1, close).split(",");
	const results: string[] = [];
	for (const alt of alternatives) {
		for (const expanded of expandBraces(`${prefix}${alt}${suffix}`)) {
			results.push(expanded);
		}
	}
	return results;
}

/** Converts a brace-free glob string into a regex fragment (no ^ or $). */
function toRegexFragment(glob: string): string {
	let result = "";
	let i = 0;
	while (i < glob.length) {
		const ch = glob[i];
		if (ch === "*") {
			if (glob[i + 1] === "*") {
				// ** matches zero or more path segments
				result += "(?:.+/|)";
				i += 2;
				// Skip trailing slash after ** if present
				if (glob[i] === "/") i++;
			} else {
				// * matches anything except /
				result += "[^/]*";
				i++;
			}
		} else if (ch === "?") {
			result += "[^/]";
			i++;
		} else if (/[.+^${}()|[\]\\]/.test(ch)) {
			// Escape regex special characters (braces are already expanded)
			result += `\\${ch}`;
			i++;
		} else {
			result += ch;
			i++;
		}
	}
	return result;
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

	const matchers = patterns.map(globToRegex);
	const results: string[] = [];

	await walkDir(dir, dir, matchers, results, fs);

	return results;
}

async function walkDir(
	root: string,
	dir: string,
	matchers: RegExp[],
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
			// normalizes the comparison string on Windows so globToRegex's
			// slash-bounded patterns resolve identically across platforms.
			// The returned absolute paths still use join() so callers see
			// platform-native results.
			const rel = toPosixPath(relative(root, fullPath));
			if (matchers.some((re) => re.test(rel))) {
				results.push(fullPath);
			}
		}
	}
}

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { toPosixPath } from "./to-posix-path.js";

// ── Directories to skip during traversal ─────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

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
export async function findTestFiles(dir: string, patterns: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
	if (patterns.length === 0) return [];

	const matchers = patterns.map(globToRegex);
	const results: string[] = [];

	await walkDir(dir, dir, matchers, results);

	return results;
}

async function walkDir(root: string, dir: string, matchers: RegExp[], results: string[]): Promise<void> {
	// readdir with withFileTypes returns Dirent entries that already know
	// whether each child is a file or directory — half the syscalls of
	// readdir-then-stat-per-entry.
	let entries: Dirent[];
	try {
		entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
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
		// Skip designated directories
		if (SKIP_DIRS.has(ent.name)) continue;

		const fullPath = join(dir, ent.name);
		if (ent.isDirectory()) {
			await walkDir(root, fullPath, matchers, results);
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

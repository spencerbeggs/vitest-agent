import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitUrlToProjectKey, normalizeWorkspaceKey } from "@vitest-agent/sdk";
import { Effect, FileSystem } from "effect";

const PACKAGE_JSON = "package.json";

const findNearestPackageJson = (startDir: string): string | null => {
	let dir = startDir;
	while (true) {
		const candidate = join(dir, PACKAGE_JSON);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
};

const readRepositoryUrl = (parsed: { repository?: unknown }): string | null => {
	const repo = parsed.repository;
	if (typeof repo === "string" && repo.trim().length > 0) return repo.trim();
	if (
		repo !== null &&
		typeof repo === "object" &&
		"url" in repo &&
		typeof (repo as { url: unknown }).url === "string"
	) {
		const url = (repo as { url: string }).url.trim();
		return url.length > 0 ? url : null;
	}
	return null;
};

/**
 * The key a `package.json` body names: the canonical `host__path` form of
 * `repository.url` when present and canonicalizable, else the normalized
 * `name`, else `null` (no usable field, or malformed JSON).
 */
const keyFromPackageJson = (content: string): string | null => {
	try {
		const parsed = JSON.parse(content) as { name?: string; repository?: unknown };
		const repoUrl = readRepositoryUrl(parsed);
		if (repoUrl !== null) {
			const key = gitUrlToProjectKey(repoUrl);
			if (key !== null) return key;
		}
		if (typeof parsed.name === "string" && parsed.name.length > 0) {
			return normalizeWorkspaceKey(parsed.name);
		}
	} catch {
		// Malformed package.json — fall through to the cwd-basename fallback.
	}
	return null;
};

const basenameKey = (cwd: string): string => {
	const basename =
		cwd
			.split("/")
			.filter((segment) => segment.length > 0)
			.pop() ?? "anonymous-project";
	return normalizeWorkspaceKey(basename);
};

/**
 * Compute the project key for a workspace by reading `package.json`
 * fields directly. Returns the canonical `host__path` form when a git
 * remote URL is present, otherwise the normalized package name.
 *
 * Always returns a non-empty string — falls back to the cwd basename
 * (or `"anonymous-project"`) so callers don't have to handle the
 * empty case.
 *
 * Synchronous and reads the real disk through `node:fs`; Effect callers
 * that already hold a `FileSystem` use
 * {@link resolveProjectKeyFromCwdEffect}, which applies the same rules.
 * @public
 */
export const resolveProjectKeyFromCwd = (cwd: string): string => {
	const pkgPath = findNearestPackageJson(cwd);
	if (pkgPath !== null) {
		let content: string | null = null;
		try {
			content = readFileSync(pkgPath, "utf-8");
		} catch {
			// Unreadable package.json — fall through to the cwd-basename fallback.
		}
		const key = content === null ? null : keyFromPackageJson(content);
		if (key !== null) return key;
	}
	return basenameKey(cwd);
};

/**
 * {@link resolveProjectKeyFromCwd} read through the ambient
 * `FileSystem` service instead of `node:fs` — same upward walk to the
 * nearest `package.json`, same precedence, same basename fallback.
 *
 * Never fails: a filesystem error while probing or reading is treated like
 * a missing or malformed `package.json`, exactly as the synchronous form
 * does.
 *
 * @param cwd - Absolute directory to start the upward walk from.
 * @public
 */
export const resolveProjectKeyFromCwdEffect = (cwd: string): Effect.Effect<string, never, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		let dir = cwd;
		while (true) {
			const candidate = join(dir, PACKAGE_JSON);
			if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
				const content = yield* fs.readFileString(candidate).pipe(Effect.orElseSucceed(() => null));
				const key = content === null ? null : keyFromPackageJson(content);
				return key ?? basenameKey(cwd);
			}
			const parent = dirname(dir);
			if (parent === dir) return basenameKey(cwd);
			dir = parent;
		}
	});

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitUrlToProjectKey } from "./canonicalize-git-url.js";
import { normalizeWorkspaceKey } from "./normalize-workspace-key.js";

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
 * Compute the project key for a workspace by reading `package.json`
 * fields directly. Returns the canonical `host__path` form when a git
 * remote URL is present, otherwise the normalized package name.
 *
 * Always returns a non-empty string — falls back to the cwd basename
 * (or `"anonymous-project"`) so callers don't have to handle the
 * empty case.
 * @public
 */
export const resolveProjectKeyFromCwd = (cwd: string): string => {
	const pkgPath = findNearestPackageJson(cwd);
	if (pkgPath !== null) {
		try {
			const parsed = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string; repository?: unknown };
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
	}
	const basename =
		cwd
			.split("/")
			.filter((segment) => segment.length > 0)
			.pop() ?? "anonymous-project";
	return normalizeWorkspaceKey(basename);
};

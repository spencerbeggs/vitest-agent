import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LenientManifest } from "@effected/package-json";
import { Walker } from "@effected/walker";
import { AppDirs } from "@effected/xdg";
import { gitUrlToProjectKey } from "@vitest-agent/sdk";
import { Effect, FileSystem, Option, Path, Result } from "effect";
import { repositoryUrlOf } from "./package-manifest.js";

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

/**
 * The key a `package.json` body names: the canonical `host__path` form of
 * `repository.url` when present and canonicalizable, else the normalized
 * `name`, else `null` (no usable field, malformed JSON, or JSON that is not
 * an object).
 */
const keyFromPackageJson = (content: string): string | null => {
	const parsed = LenientManifest.parseResult(content);
	if (Result.isFailure(parsed)) return null;
	const manifest = parsed.success;
	const repoUrl = repositoryUrlOf(manifest.repository);
	if (repoUrl !== null) {
		const key = gitUrlToProjectKey(repoUrl);
		if (key !== null) return key;
	}
	// A name that is no usable directory segment (`.`, `..`) is no key.
	if (manifest.name !== undefined) return Result.getOrNull(AppDirs.segment(manifest.name));
	return null;
};

const basenameKey = (cwd: string): string => {
	const basename =
		cwd
			.split("/")
			.filter((segment) => segment.length > 0)
			.pop() ?? "anonymous-project";
	return Result.getOrElse(AppDirs.segment(basename), () => "anonymous-project");
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
 * nearest `package.json` (`@effected/walker`'s `Walker.ascend` +
 * `Walker.findUpward`), same precedence, same basename fallback.
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
		const dirs = yield* Walker.ascend(cwd);
		const found = yield* Walker.findUpward(dirs, (dir) => [join(dir, PACKAGE_JSON)]);
		if (Option.isNone(found)) return basenameKey(cwd);
		const content = yield* fs.readFileString(found.value).pipe(Effect.orElseSucceed(() => null));
		const key = content === null ? null : keyFromPackageJson(content);
		return key ?? basenameKey(cwd);
	}).pipe(Effect.provide(Path.layer));

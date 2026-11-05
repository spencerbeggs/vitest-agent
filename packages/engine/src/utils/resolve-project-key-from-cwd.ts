import { NodeSyncFileSystem } from "@effected/memfs/node-sync";
import { LenientManifest } from "@effected/package-json";
import { Walker } from "@effected/walker";
import { AppDirs } from "@effected/xdg";
import { gitUrlToProjectKey } from "@vitest-agent/sdk";
import { Effect, FileSystem, Option, Path, Result } from "effect";
import { repositoryUrlOf } from "./package-manifest.js";

const PACKAGE_JSON = "package.json";

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

// The last segment of `cwd` under the ambient `Path`: `path.basename` drops
// trailing separators and is empty for a root (`/`, `C:\\`).
const basenameKey = (path: Path.Path, cwd: string): string => {
	const basename = path.basename(cwd);
	return basename.length === 0
		? "anonymous-project"
		: Result.getOrElse(AppDirs.segment(basename), () => "anonymous-project");
};

// The synchronous form's platform: a read-only `node:fs` FileSystem whose
// read members are synchronous, plus the host's Node `Path` (win32 on
// Windows), so the Effect form below runs to completion under `runSync`.
const NodeSyncPlatform = NodeSyncFileSystem.layerWithPath;

/**
 * Compute the project key for a workspace by reading `package.json`
 * fields directly. Returns the canonical `host__path` form when a git
 * remote URL is present, otherwise the normalized package name.
 *
 * Always returns a non-empty string — falls back to the cwd basename
 * (or `"anonymous-project"`) so callers don't have to handle the
 * empty case.
 *
 * Synchronous and reads the real disk through `node:fs`: it runs
 * {@link resolveProjectKeyFromCwdEffect} under `Effect.runSync` over a
 * read-only synchronous `FileSystem` and the host's Node `Path`. Effect
 * callers that already hold a `FileSystem` and `Path` use the Effect form
 * directly.
 * @public
 */
export const resolveProjectKeyFromCwd = (cwd: string): string =>
	Effect.runSync(resolveProjectKeyFromCwdEffect(cwd).pipe(Effect.provide(NodeSyncPlatform)));

/**
 * {@link resolveProjectKeyFromCwd} read through the ambient
 * `FileSystem` and `Path` services instead of `node:fs` — same upward walk to the
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
export const resolveProjectKeyFromCwdEffect = (
	cwd: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dirs = yield* Walker.ascend(cwd);
		const found = yield* Walker.findUpward(dirs, (dir) => [path.join(dir, PACKAGE_JSON)]);
		if (Option.isNone(found)) return basenameKey(path, cwd);
		const content = yield* fs.readFileString(found.value).pipe(Effect.orElseSucceed(() => null));
		const key = content === null ? null : keyFromPackageJson(content);
		return key ?? basenameKey(path, cwd);
	});

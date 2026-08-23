import type { WorkspaceDiscoveryFailure } from "@effected/workspaces";
import { WorkspaceDiscovery, WorkspaceRootNotFoundError } from "@effected/workspaces";
import { Effect } from "effect";
import { normalizeWorkspaceKey } from "./normalize-workspace-key.js";

/**
 * Resolve the normalized workspace key for the workspace containing
 * `projectDir`.
 *
 * The key is the root `package.json`'s `name`, normalized via
 * `normalizeWorkspaceKey`. This becomes the directory segment under
 * `$XDG_DATA_HOME/vitest-agent/` where the SQLite database lives.
 *
 * Fails with `WorkspaceRootNotFoundError` when no root workspace is
 * discoverable. `WorkspacePackage.name` is enforced non-empty by
 * `@effected/workspaces`'s schema, so a successful root lookup always yields a
 * usable name.
 *
 * Discovery is anchored at `projectDir` per call via `listPackagesIn`, not at
 * the `WorkspaceDiscovery` layer's `cwd`: patterns, member manifests and names
 * are read from beneath `projectDir`'s own root, so one long-lived layer
 * answers correctly for a git worktree, a nested repository, or an unrelated
 * project. Fails with the library's `WorkspaceRootNotFoundError` when
 * `projectDir` sits in no workspace at all; results are memoized per resolved
 * root, so many directories in one workspace share a single discovery.
 *
 * @param projectDir - Absolute path inside the workspace. Typically the
 *   reporter's resolved `projectDir` (CLAUDE_PROJECT_DIR or process.cwd()).
 * @public
 */
export const resolveWorkspaceKey = (
	projectDir: string,
): Effect.Effect<string, WorkspaceRootNotFoundError | WorkspaceDiscoveryFailure, WorkspaceDiscovery> =>
	Effect.gen(function* () {
		const discovery = yield* WorkspaceDiscovery;
		const packages = yield* discovery.listPackagesIn(projectDir);
		const root = packages.find((pkg) => pkg.isRootWorkspace);
		if (!root) {
			return yield* Effect.fail(
				new WorkspaceRootNotFoundError({
					searchPath: projectDir,
					markers: [],
				}),
			);
		}
		return normalizeWorkspaceKey(root.name);
	});

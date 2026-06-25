import { Effect } from "effect";
import type { WorkspaceDiscoveryError } from "workspaces-effect";
import { WorkspaceDiscovery, WorkspaceRootNotFoundError } from "workspaces-effect";
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
 * discoverable from `projectDir`. `WorkspacePackage.name` is enforced
 * non-empty by `workspaces-effect`'s schema, so a successful root lookup
 * always yields a usable name.
 *
 * @param projectDir - Absolute path inside the workspace. Typically the
 *   reporter's resolved `projectDir` (CLAUDE_PROJECT_DIR or process.cwd()).
 * @public
 */
export const resolveWorkspaceKey = (
	projectDir: string,
): Effect.Effect<string, WorkspaceRootNotFoundError | WorkspaceDiscoveryError, WorkspaceDiscovery> =>
	Effect.gen(function* () {
		const discovery = yield* WorkspaceDiscovery;
		const packages = yield* discovery.listPackages(projectDir);
		const root = packages.find((pkg) => pkg.isRootWorkspace);
		if (!root) {
			return yield* Effect.fail(
				new WorkspaceRootNotFoundError({
					searchPath: projectDir,
					reason: "No root workspace package found in the discovered package list.",
				}),
			);
		}
		return normalizeWorkspaceKey(root.name);
	});

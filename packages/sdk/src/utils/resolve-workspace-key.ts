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
 * Note (v4): `@effected/workspaces` anchors discovery at the `WorkspaceDiscovery`
 * layer's `cwd`, not at a per-call path — `discovery.listPackages()` takes no
 * argument. `projectDir` is retained for the not-found diagnostic; callers that
 * need to anchor at a specific directory build `WorkspaceDiscovery.layer({ cwd })`.
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
		const packages = yield* discovery.listPackages();
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

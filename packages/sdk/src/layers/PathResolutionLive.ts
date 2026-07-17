import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { AppDirs, Xdg } from "@effected/xdg";
import { Layer } from "effect";
import { ConfigLive } from "./ConfigLive.js";

const APP_NAMESPACE = "vitest-agent";

/**
 * `AppDirs` over the ambient `Xdg` environment, bound to a `const` so the
 * layer memoizes by reference (calling `AppDirs.layer(...)` inline at two
 * provide sites would resolve two independent services). Requires
 * `FileSystem` + `Path` at the edge.
 */
const AppDirsLive = AppDirs.layer({ namespace: APP_NAMESPACE }).pipe(Layer.provide(Xdg.layer));

/**
 * Composite layer providing every service `resolveDataPath` requires:
 * `AppDirs` (XDG path resolution), `VitestAgentConfigFile` (TOML
 * config loader), and `WorkspaceDiscovery` / `WorkspaceRoot` (workspace name
 * lookup).
 *
 * Callers still need to provide `FileSystem` and `Path` from
 * `@effect/platform-node`'s `NodeServices.layer` (or the equivalent on Bun).
 *
 * `WorkspaceDiscovery` is anchored at `projectDir`: on v4,
 * `@effected/workspaces` resolves the workspace root from the layer's `cwd`
 * rather than a per-call path, so the `cwd` is pinned here.
 *
 * @param projectDir - Absolute path inside the user's workspace, used to
 *   anchor the config file resolvers and workspace discovery.
 * @public
 */
export const PathResolutionLive = (projectDir: string) => {
	const WorkspaceMinimalLive = WorkspaceDiscovery.layer({ cwd: projectDir }).pipe(Layer.provide(WorkspaceRoot.layer));
	return Layer.mergeAll(AppDirsLive, ConfigLive(projectDir), WorkspaceMinimalLive);
};

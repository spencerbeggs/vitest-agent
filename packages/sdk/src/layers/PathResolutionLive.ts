import { Layer } from "effect";
import { WorkspaceDiscoveryLive, WorkspaceRootLive } from "workspaces-effect";
import { AppDirsConfig, XdgLive } from "xdg-effect";
import { ConfigLive } from "./ConfigLive.js";

const APP_NAMESPACE = "vitest-agent";

/**
 * Minimal slice of `workspaces-effect` for `resolveWorkspaceKey`.
 *
 * `WorkspacesLive` from `workspaces-effect` composes seven services and
 * runs eager I/O at layer construction in `LockfileReaderLive` (reads and
 * parses the entire lockfile). We only call `WorkspaceDiscovery.listPackages`
 * to read the root `package.json`'s `name` — `WorkspaceRoot` is the only
 * upstream dependency `WorkspaceDiscoveryLive` actually needs. Skipping
 * the rest avoids the lockfile-read cost on every reporter init, which
 * otherwise fires once per Vitest project (5+ reads on monorepos).
 */
const WorkspaceMinimalLive = WorkspaceDiscoveryLive.pipe(Layer.provide(WorkspaceRootLive));

/**
 * Composite layer providing every service `resolveDataPath` requires:
 * `AppDirs` (XDG path resolution), `VitestAgentConfigFile` (TOML
 * config loader), `WorkspaceDiscovery` and `WorkspaceRoot` (workspace name
 * lookup).
 *
 * Callers still need to provide `FileSystem` and `Path` from
 * `@effect/platform-node`'s `NodeContext.layer` (or the equivalent on Bun).
 *
 * @param projectDir - Absolute path inside the user's workspace, used to
 *   anchor the config file resolvers.
 * @public
 */
export const PathResolutionLive = (projectDir: string) =>
	Layer.mergeAll(
		XdgLive(new AppDirsConfig({ namespace: APP_NAMESPACE })),
		ConfigLive(projectDir),
		WorkspaceMinimalLive,
	);

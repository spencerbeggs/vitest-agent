import { Git } from "@effected/git";
import { LenientManifest } from "@effected/package-json";
import { WorkspaceDiscovery } from "@effected/workspaces";
import { AppDirs } from "@effected/xdg";
import type { ProjectIdentityCandidate, ProjectIdentityError } from "@vitest-agent/sdk";
import { ProjectIdentityNotResolvableError, ProjectIdentitySourceError, VitestAgentConfig } from "@vitest-agent/sdk";
import { Effect, FileSystem, Layer, Option, Result } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { VitestAgentConfigFile } from "../services/Config.js";
import type { ProjectIdentityCandidates, ResolvedIdentity } from "../services/ProjectIdentity.js";
import { ProjectIdentity, resolveProjectIdentityFromCandidates } from "../services/ProjectIdentity.js";
import { repositoryUrlOf } from "../utils/package-manifest.js";

/** The one-line text of a kit failure, for `ProjectIdentitySourceError.detail`. */
const detailOf = (cause: unknown): string =>
	cause instanceof Error && cause.message.length > 0 ? cause.message : String(cause);

/**
 * The git remote is an OPTIONAL source: a repository with no
 * `remote.origin.url`, a directory that is not a git checkout, or a machine
 * with no `git` on `PATH` are all "no remote" rather than failures, so every
 * `Git` failure folds to `Option.none()` on purpose — this is the one catch
 * in this module that stays broad, and it is a policy, not an accident.
 *
 * Read as the RAW config value (`Git.configGet`, i.e. `git config --get
 * remote.origin.url`), not `Git.remoteUrl`: `git remote get-url` applies
 * `url.<base>.insteadOf` rewrites, and the project key derived from this URL
 * names the persisted data directory, so a rewrite must not re-key it.
 */
const readGitRemote = (cwd: string): Effect.Effect<Option.Option<string>, never, Git> =>
	Effect.flatMap(Git, (git) => git.configGet(cwd, "remote.origin.url")).pipe(
		Effect.map(Option.filter((url) => url.length > 0)),
		Effect.orElseSucceed(() => Option.none<string>()),
	);

/**
 * The `repository` URL of the root `package.json` discovery named.
 *
 * A file that is not there (`NotFound`) is an absent source. Any other
 * filesystem failure (permission denied, an I/O error) and a body that is not
 * JSON (`@effected/package-json`'s `PackageJsonSyntaxError`, `invalid-json`)
 * are `ProjectIdentitySourceError`s: the file exists and says
 * something, and silently reading it as "no repository" would hand the
 * operator the wrong identity.
 */
const readPackageRepoUrl = (
	packageJsonPath: string,
): Effect.Effect<Option.Option<string>, ProjectIdentitySourceError, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const raw = yield* fs.readFileString(packageJsonPath).pipe(
			Effect.map(Option.some),
			Effect.catchTag("PlatformError", (error) =>
				error.reason._tag === "NotFound"
					? Effect.succeed(Option.none<string>())
					: Effect.fail(
							new ProjectIdentitySourceError({
								source: "package-json",
								path: packageJsonPath,
								detail: detailOf(error),
								cause: error,
							}),
						),
			),
		);
		if (Option.isNone(raw)) return Option.none<string>();
		// JSON that is not an object (`[]`, `"x"`) names no repository, as it
		// did before the kit; only text that is not JSON at all fails typed.
		const manifest = yield* LenientManifest.parse(raw.value).pipe(
			Effect.map(Option.some),
			Effect.catchTag("PackageJsonSyntaxError", (cause) =>
				cause.reason === "not-an-object"
					? Effect.succeed(Option.none<LenientManifest>())
					: Effect.fail(
							new ProjectIdentitySourceError({
								source: "package-json",
								path: packageJsonPath,
								detail: detailOf(cause),
								cause,
							}),
						),
			),
		);
		return Option.flatMap(manifest, (m) => Option.fromNullishOr(repositoryUrlOf(m.repository)));
	});

/**
 * Effect environment type required by the `ProjectIdentityLive` layer.
 * Exported only so the layer's
 * `Layer.Layer<ProjectIdentity, never, CandidateContext>` signature
 * has a named referent — consumers should provide the four named
 * services (FileSystem, WorkspaceDiscovery, VitestAgentConfigFile,
 * ChildProcessSpawner, which feeds the layer's own `@effected/git` `Git`)
 * rather than reference this type directly.
 *
 * @public
 */
export type CandidateContext =
	| FileSystem.FileSystem
	| WorkspaceDiscovery
	| VitestAgentConfigFile
	| ChildProcessSpawner.ChildProcessSpawner;

const collectCandidates = (
	workspaceRoot: string,
	options: { projectId?: string },
): Effect.Effect<
	ProjectIdentityCandidates,
	ProjectIdentitySourceError,
	FileSystem.FileSystem | WorkspaceDiscovery | VitestAgentConfigFile | Git
> =>
	Effect.gen(function* () {
		const configFile = yield* VitestAgentConfigFile;
		// `loadOrDefault` already answers an ABSENT file with the default; what
		// it can still fail with — an unreadable file, TOML that does not parse,
		// a body `VitestAgentConfig` rejects — is a present-but-broken config,
		// which must reach the operator rather than default silently (#321).
		const tomlConfig = yield* configFile.loadOrDefault(new VitestAgentConfig({})).pipe(
			Effect.mapError(
				(cause) =>
					new ProjectIdentitySourceError({
						source: "toml",
						path:
							cause._tag === "ConfigValidationError"
								? Option.getOrElse(cause.path, () => workspaceRoot)
								: (cause.path ?? workspaceRoot),
						detail: detailOf(cause),
						cause,
					}),
			),
		);

		const gitRemote = yield* readGitRemote(workspaceRoot);

		const discovery = yield* WorkspaceDiscovery;
		// Anchored at the per-call `workspaceRoot`, not the layer's `cwd`: one
		// long-lived host (the MCP server) resolves identity for whichever
		// project a call names, including a git worktree or a nested repo whose
		// membership differs from the root the layer was built against.
		//
		// No workspace root at all is an absent source (no packages). A root
		// whose manifests or `packages:` patterns discovery rejects is a
		// present-but-broken one and fails typed.
		const packages = yield* discovery.listPackagesIn(workspaceRoot).pipe(
			Effect.catchTag("WorkspaceRootNotFoundError", () => Effect.succeed([] as never[])),
			Effect.mapError(
				(cause) =>
					new ProjectIdentitySourceError({
						source: "workspace",
						path: cause._tag === "WorkspacePatternError" ? cause.root : cause.path,
						detail: detailOf(cause),
						cause,
					}),
			),
		);
		const root = packages.find((pkg) => pkg.isRootWorkspace);

		const packageJsonRepoUrl = root ? yield* readPackageRepoUrl(root.packageJsonPath) : Option.none<string>();

		const candidates: { -readonly [K in keyof ProjectIdentityCandidates]?: ProjectIdentityCandidates[K] } = {};
		if (options.projectId !== undefined) candidates.explicit = options.projectId;
		if (tomlConfig.projectKey !== undefined) {
			// A configured key that maps to `.` or `..` would name a directory
			// outside the data root. It is the operator's explicit choice, so it
			// fails loudly rather than falling through to another source.
			const segment = AppDirs.segment(tomlConfig.projectKey);
			if (Result.isFailure(segment)) {
				return yield* new ProjectIdentitySourceError({
					source: "toml",
					path: workspaceRoot,
					detail: `projectKey ${JSON.stringify(tomlConfig.projectKey)} is not a usable directory name (${segment.failure.message})`,
					cause: segment.failure,
				});
			}
			candidates.toml = tomlConfig.projectKey;
		}
		const remoteValue = Option.getOrUndefined(gitRemote);
		if (remoteValue !== undefined) candidates.gitRemote = remoteValue;
		const repoUrlValue = Option.getOrUndefined(packageJsonRepoUrl);
		if (repoUrlValue !== undefined) candidates.packageJsonRepoUrl = repoUrlValue;
		if (root?.name !== undefined) candidates.packageJsonName = root.name;
		return candidates;
	});

const candidatesToTriedList = (candidates: ProjectIdentityCandidates): ReadonlyArray<ProjectIdentityCandidate> => [
	{
		source: "explicit",
		reason: candidates.explicit ? "value rejected by normalizer" : "not provided in plugin options",
	},
	{
		source: "toml",
		reason: candidates.toml ? "value rejected by normalizer" : "not configured in vitest-agent.config.toml",
	},
	{
		source: "git-remote",
		reason: candidates.gitRemote ? "URL not canonicalizable" : "git command produced no remote.origin.url",
	},
	{
		source: "package-repository",
		reason: candidates.packageJsonRepoUrl ? "URL not canonicalizable" : "no repository.url in root package.json",
	},
	{
		source: "package-name",
		reason: candidates.packageJsonName ? "value rejected by normalizer" : "no name in root package.json",
	},
];

/**
 * Live layer that wires the resolver into real I/O. Requires
 * `FileSystem`, `CommandExecutor`, `WorkspaceDiscovery`, and
 * `VitestAgentConfigFile`. The platform context comes from
 * `NodeServices.layer` at the entry point.
 *
 * Absent sources fall through (no config file, no workspace root, no
 * `repository` field, no git remote); a present source that cannot be read
 * or decoded fails with `ProjectIdentitySourceError`.
 * @public
 */
export const ProjectIdentityLive: Layer.Layer<ProjectIdentity, never, CandidateContext> = Layer.effect(
	ProjectIdentity,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const discovery = yield* WorkspaceDiscovery;
		const configFile = yield* VitestAgentConfigFile;
		const git = yield* Git;
		return {
			resolve: (workspaceRoot: string, options = {}) =>
				collectCandidates(workspaceRoot, options).pipe(
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(WorkspaceDiscovery, discovery),
					Effect.provideService(VitestAgentConfigFile, configFile),
					Effect.provideService(Git, git),
					Effect.flatMap((candidates) => {
						const result = resolveProjectIdentityFromCandidates(candidates);
						if (result === null) {
							return Effect.fail(new ProjectIdentityNotResolvableError({ tried: candidatesToTriedList(candidates) }));
						}
						return Effect.succeed(result);
					}),
				),
		};
	}),
).pipe(Layer.provide(Git.layer));

/**
 * Build a Test layer that returns a fixed `ResolvedIdentity` (or
 * fails with the given `ProjectIdentityError`). Use in unit tests
 * that depend on `ProjectIdentity` but don't want to wire upstream
 * services.
 * @public
 */
export const ProjectIdentityTest = (
	result: ResolvedIdentity | ProjectIdentityError,
): Layer.Layer<ProjectIdentity, never, never> =>
	Layer.succeed(ProjectIdentity, {
		resolve: () =>
			result instanceof ProjectIdentityNotResolvableError || result instanceof ProjectIdentitySourceError
				? Effect.fail(result)
				: Effect.succeed(result),
	});

/**
 * Live and Test layers for {@link ProjectIdentity}.
 *
 * The Live layer collects each candidate from real I/O — git remote
 * via `Command`, TOML config via `VitestAgentConfigFile`, root
 * `package.json` via `WorkspaceDiscovery` plus
 * `FileSystem.readFileString` — and delegates priority resolution to
 * the pure `resolveProjectIdentityFromCandidates` helper.
 *
 * @packageDocumentation
 */

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import type { Context } from "effect";
import { Effect, Layer, Option } from "effect";
import { WorkspaceDiscovery } from "workspaces-effect";
import type { ProjectIdentityCandidate } from "../errors/ProjectIdentityError.js";
import { ProjectIdentityNotResolvableError } from "../errors/ProjectIdentityError.js";
import { VitestAgentConfig } from "../schemas/Config.js";
import { VitestAgentConfigFile } from "../services/Config.js";
import type { ProjectIdentityCandidates, ResolvedIdentity } from "../services/ProjectIdentity.js";
import { ProjectIdentity, resolveProjectIdentityFromCandidates } from "../services/ProjectIdentity.js";

const readGitRemote = (cwd: string): Effect.Effect<Option.Option<string>, never, CommandExecutor.CommandExecutor> =>
	Command.make("git", "config", "--get", "remote.origin.url").pipe(
		Command.workingDirectory(cwd),
		Command.string,
		Effect.map((output) => {
			const trimmed = output.trim();
			return trimmed.length > 0 ? Option.some(trimmed) : Option.none<string>();
		}),
		Effect.catchAll(() => Effect.succeed(Option.none<string>())),
	);

const readPackageRepoUrl = (
	packageJsonPath: string,
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const raw = yield* fs.readFileString(packageJsonPath).pipe(Effect.catchAll(() => Effect.succeed("")));
		if (raw.length === 0) return Option.none<string>();
		try {
			const parsed = JSON.parse(raw) as { repository?: unknown };
			const repo = parsed.repository;
			if (typeof repo === "string" && repo.trim().length > 0) {
				return Option.some(repo.trim());
			}
			if (
				repo !== null &&
				typeof repo === "object" &&
				"url" in repo &&
				typeof (repo as { url: unknown }).url === "string"
			) {
				const url = (repo as { url: string }).url.trim();
				return url.length > 0 ? Option.some(url) : Option.none<string>();
			}
		} catch {
			// Malformed package.json — skip the candidate, don't fail.
		}
		return Option.none<string>();
	});

/**
 * Effect environment type required by `collectCandidates` and the
 * `ProjectIdentityLive` layer. Exported only so the layer's
 * `Layer.Layer<ProjectIdentity, never, CandidateContext>` signature
 * has a named referent — consumers should provide the four named
 * services (FileSystem, WorkspaceDiscovery, VitestAgentConfigFile,
 * CommandExecutor) rather than reference this type directly.
 *
 * @internal
 */
export type CandidateContext =
	| FileSystem.FileSystem
	| WorkspaceDiscovery
	| Context.Tag.Identifier<typeof VitestAgentConfigFile>
	| CommandExecutor.CommandExecutor;

const collectCandidates = (
	workspaceRoot: string,
	options: { projectId?: string },
): Effect.Effect<ProjectIdentityCandidates, never, CandidateContext> =>
	Effect.gen(function* () {
		const configFile = yield* VitestAgentConfigFile;
		const tomlConfig = yield* configFile
			.loadOrDefault(new VitestAgentConfig({}))
			.pipe(Effect.catchAll(() => Effect.succeed(new VitestAgentConfig({}))));

		const gitRemote = yield* readGitRemote(workspaceRoot);

		const discovery = yield* WorkspaceDiscovery;
		const packages = yield* discovery
			.listPackages(workspaceRoot)
			.pipe(Effect.catchAll(() => Effect.succeed([] as never[])));
		const root = packages.find((pkg) => pkg.isRootWorkspace);

		const packageJsonRepoUrl = root ? yield* readPackageRepoUrl(root.packageJsonPath) : Option.none<string>();

		const candidates: { -readonly [K in keyof ProjectIdentityCandidates]?: ProjectIdentityCandidates[K] } = {};
		if (options.projectId !== undefined) candidates.explicit = options.projectId;
		if (tomlConfig.projectKey !== undefined) candidates.toml = tomlConfig.projectKey;
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
 * `NodeContext.layer` at the entry point.
 */
export const ProjectIdentityLive: Layer.Layer<ProjectIdentity, never, CandidateContext> = Layer.effect(
	ProjectIdentity,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const discovery = yield* WorkspaceDiscovery;
		const configFile = yield* VitestAgentConfigFile;
		const executor = yield* CommandExecutor.CommandExecutor;
		return {
			resolve: (workspaceRoot: string, options = {}) =>
				collectCandidates(workspaceRoot, options).pipe(
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(WorkspaceDiscovery, discovery),
					Effect.provideService(VitestAgentConfigFile, configFile),
					Effect.provideService(CommandExecutor.CommandExecutor, executor),
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
);

/**
 * Build a Test layer that returns a fixed `ResolvedIdentity` (or
 * fails with `ProjectIdentityNotResolvableError`). Use in unit tests
 * that depend on `ProjectIdentity` but don't want to wire upstream
 * services.
 */
export const ProjectIdentityTest = (
	result: ResolvedIdentity | ProjectIdentityNotResolvableError,
): Layer.Layer<ProjectIdentity, never, never> =>
	Layer.succeed(ProjectIdentity, {
		resolve: () => (result instanceof ProjectIdentityNotResolvableError ? Effect.fail(result) : Effect.succeed(result)),
	});

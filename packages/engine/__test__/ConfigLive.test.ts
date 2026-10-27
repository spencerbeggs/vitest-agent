import { Git, NotARepositoryError } from "@effected/git";
import { MemoryFileSystem } from "@effected/memfs";
import { VitestAgentConfig } from "@vitest-agent/sdk";
import { Effect, Layer, Path } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigLive } from "../src/layers/ConfigLive.js";
import { VitestAgentConfigFile } from "../src/services/Config.js";

const WORKSPACE_DIR = "/workspace";

/**
 * Workspace marker so `@effected/config-file`'s `WorkspaceRoot` resolver
 * succeeds. Every seed below carries it; a seed without it is not a workspace.
 */
const WORKSPACE_MARKER = { "/workspace/pnpm-workspace.yaml": "packages: []\n" };

/**
 * Loads the config against a virtual volume seeded with `seed`.
 *
 * The volume replaces the `mkdtemp` + `writeFile` + `rmSync` fixture this
 * suite used to build: `ConfigLive` reaches the filesystem exclusively through
 * `FileSystem.FileSystem` (see `src/layers/ConfigLive.ts`), so a memory volume
 * serves it completely. Unseeded paths fail `NotFound` rather than reading as
 * an empty file, which is what makes the "no file present" case below a real
 * assertion instead of a stub's phantom answer.
 */
const loadConfig = (seed: Record<string, string>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const config = yield* VitestAgentConfigFile;
			return yield* config.loadOrDefault(new VitestAgentConfig({}));
		}).pipe(
			Effect.provide(
				ConfigLive(WORKSPACE_DIR).pipe(
					Layer.provide(Layer.mergeAll(MemoryFileSystem.layerWith({ ...WORKSPACE_MARKER, ...seed }), Path.layer)),
				),
			),
		),
	);

describe("ConfigLive", () => {
	it("returns the default empty config when no file is present", async () => {
		const result = await loadConfig({});
		expect(result.cacheDir).toBeUndefined();
		expect(result.projectKey).toBeUndefined();
	});

	it("loads cacheDir override from a workspace-root config file", async () => {
		const result = await loadConfig({ "/workspace/vitest-agent.config.toml": 'cacheDir = "/tmp/custom"\n' });
		expect(result.cacheDir).toBe("/tmp/custom");
	});

	it("loads projectKey override from a workspace-root config file", async () => {
		const result = await loadConfig({ "/workspace/vitest-agent.config.toml": 'projectKey = "my-app-personal"\n' });
		expect(result.projectKey).toBe("my-app-personal");
	});

	it("loads both fields from a single config file", async () => {
		const result = await loadConfig({
			"/workspace/vitest-agent.config.toml": 'cacheDir = "/tmp/custom"\nprojectKey = "my-app"\n',
		});
		expect(result.cacheDir).toBe("/tmp/custom");
		expect(result.projectKey).toBe("my-app");
	});

	describe("upward walk ceiling", () => {
		// No workspace marker and no `.git` entry, so only the upward walk can
		// find a file; the config sits ABOVE the repository root git answers.
		const PROJECT = "/outer/repo/pkg";
		const ABOVE_REPO = { "/outer/vitest-agent.config.toml": 'projectKey = "leaked"\n' };
		const loadFrom = (seed: Record<string, string>, git: Layer.Layer<never> | Layer.Layer<Git>) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const config = yield* VitestAgentConfigFile;
					return yield* config.loadOrDefault(new VitestAgentConfig({}));
				}).pipe(
					Effect.provide(
						ConfigLive(PROJECT).pipe(
							Layer.provide(Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer)),
							Layer.provide(git),
						),
					),
				),
			);

		it("stops at the git repository root, so a file above the repository is not read", async () => {
			const inRepo = Git.layerTest({ repoRoot: () => Effect.succeed("/outer/repo") });
			const result = await loadFrom({ ...ABOVE_REPO, "/outer/repo/pkg/index.ts": "" }, inRepo);
			expect(result.projectKey).toBeUndefined();
		});

		it("still finds a file between the project and the repository root", async () => {
			const inRepo = Git.layerTest({ repoRoot: () => Effect.succeed("/outer/repo") });
			const result = await loadFrom(
				{ ...ABOVE_REPO, "/outer/repo/vitest-agent.config.toml": 'projectKey = "inside"\n' },
				inRepo,
			);
			expect(result.projectKey).toBe("inside");
		});

		it("walks to the filesystem root outside a repository", async () => {
			const notARepo = Git.layerTest({ repoRoot: (cwd) => Effect.fail(NotARepositoryError.make({ cwd })) });
			const seed = { ...ABOVE_REPO, "/outer/repo/pkg/index.ts": "" };
			expect((await loadFrom(seed, notARepo)).projectKey).toBe("leaked");
			// No Git and no spawner in context: no ceiling, as before.
			expect((await loadFrom(seed, Layer.empty)).projectKey).toBe("leaked");
		});
	});
});

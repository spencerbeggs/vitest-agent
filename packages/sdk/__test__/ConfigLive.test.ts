import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigLive } from "../src/layers/ConfigLive.js";
import { VitestAgentConfig } from "../src/schemas/Config.js";
import { VitestAgentConfigFile } from "../src/services/Config.js";

let workspaceDir: string;

beforeEach(() => {
	workspaceDir = mkdtempSync(join(tmpdir(), "vitest-agent-config-"));
	// Workspace marker so config-file-effect's WorkspaceRoot resolver succeeds
	writeFileSync(join(workspaceDir, "pnpm-workspace.yaml"), "packages: []\n");
});

afterEach(() => {
	rmSync(workspaceDir, { recursive: true, force: true });
});

const loadConfig = (projectDir: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const config = yield* VitestAgentConfigFile;
			return yield* config.loadOrDefault(new VitestAgentConfig({}));
		}).pipe(Effect.provide(ConfigLive(projectDir).pipe(Layer.provide(NodeContext.layer)))),
	);

describe("ConfigLive", () => {
	it("returns the default empty config when no file is present", async () => {
		const result = await loadConfig(workspaceDir);
		expect(result.cacheDir).toBeUndefined();
		expect(result.projectKey).toBeUndefined();
	});

	it("loads cacheDir override from a workspace-root config file", async () => {
		writeFileSync(join(workspaceDir, "vitest-agent.config.toml"), 'cacheDir = "/tmp/custom"\n');
		const result = await loadConfig(workspaceDir);
		expect(result.cacheDir).toBe("/tmp/custom");
	});

	it("loads projectKey override from a workspace-root config file", async () => {
		writeFileSync(join(workspaceDir, "vitest-agent.config.toml"), 'projectKey = "my-app-personal"\n');
		const result = await loadConfig(workspaceDir);
		expect(result.projectKey).toBe("my-app-personal");
	});

	it("loads both fields from a single config file", async () => {
		writeFileSync(join(workspaceDir, "vitest-agent.config.toml"), 'cacheDir = "/tmp/custom"\nprojectKey = "my-app"\n');
		const result = await loadConfig(workspaceDir);
		expect(result.cacheDir).toBe("/tmp/custom");
		expect(result.projectKey).toBe("my-app");
	});
});

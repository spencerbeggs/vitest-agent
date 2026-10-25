import { AgentPlugin } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

// Issue #626: the pure-tier packages share no module-level state across test
// files, so they skip per-file worker isolation and reuse each fork's module
// graph (effect and the kit load once per worker instead of once per file).
// mcp, cli, plugin, sidecar and playground keep the root's forks + isolation:
// mcp calls process.chdir() and keys state on globalThis (unaudited for
// cross-file leaks), and the others spawn processes or built bins.
const noIsolation = { isolate: false } as const;

export default async () => {
	const { projects, tags } = await AgentPlugin.discover({
		configure: {
			"@vitest-agent/sdk": noIsolation,
			"@vitest-agent/engine": noIsolation,
			"@vitest-agent/ui": noIsolation,
			"@vitest-agent/reporter": noIsolation,
		},
	});
	return defineConfig({
		plugins: [
			AgentPlugin({
				console: {
					human: "stream",
					agent: "agent",
				},
				coverageTargets: AgentPlugin.COVERAGE_LEVELS.basic.coverageTargets,
			}),
		],
		test: {
			...(projects ? { projects } : {}),
			tags,
			pool: "forks",
			globalSetup: ["vitest.setup.ts"],
			coverage: {
				enabled: true,
				provider: "v8",
				excludeAfterRemap: true,
				thresholds: AgentPlugin.COVERAGE_LEVELS.basic.thresholds,
				exclude: [
					"**/*.{test,spec}.ts",
					"**/cli/src/bin.ts",
					"**/cli/src/index.ts",
					"**/cli/src/main.ts",
					"**/reporter/src/index.ts",
					"**/plugin/src/index.ts",
					"**/cli/src/commands/**",
					"**/cli/src/layers/**",
					"**/engine/src/services/*.ts",
					"**/engine/src/migrations/**",
					"**/engine/src/layers/OutputPipelineLive.ts",
				],
			},
		},
	});
};

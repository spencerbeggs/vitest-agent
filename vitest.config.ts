import { defineConfig } from "vitest/config";
import { AgentPlugin } from "vitest-agent-plugin";

export default async () => {
	const projects = await AgentPlugin.discover();
	return defineConfig({
		plugins: [
			AgentPlugin({
				mode: "agent",
				strategy: "own",
				mcp: true,
				coverageThresholds: AgentPlugin.COVERAGE_LEVELS.none,
				coverageTargets: AgentPlugin.COVERAGE_LEVELS.standard,
			}),
		],
		test: {
			projects,
			pool: "forks",
			globalSetup: ["vitest.setup.ts"],
			coverage: {
				enabled: true,
				provider: "v8",
				exclude: [
					"**/*.{test,spec}.ts",
					// Bin entrypoints
					"packages/cli/src/bin.ts",
					// Re-export barrels with no runtime logic
					"packages/cli/src/index.ts",
					"packages/reporter/src/index.ts",
					"packages/plugin/src/index.ts",
					// CLI commands are thin @effect/cli wrappers; testable logic lives in lib/format-*.ts
					"packages/cli/src/commands/**",
					"packages/cli/src/layers/**",
					// Effect Context.Tag definitions — type identifiers with no testable logic
					"packages/sdk/src/services/*.ts",
					// SQL migration scripts — tested indirectly via DataStore integration tests
					"packages/sdk/src/migrations/**",
					// Pure Layer.mergeAll() composition with no logic
					"packages/sdk/src/layers/OutputPipelineLive.ts",
					// Always returns [] — no logic to cover
					"packages/sdk/src/formatters/silent.ts",
				],
			},
		},
	});
};

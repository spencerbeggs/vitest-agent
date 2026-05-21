import { defineConfig } from "vitest/config";
import { AgentPlugin } from "vitest-agent-plugin";

export default async () => {
	const { projects, tags } = await AgentPlugin.discover();
	const coverage = AgentPlugin.COVERAGE_LEVELS.basic;
	return defineConfig({
		plugins: [
			AgentPlugin({
				console: { human: "stream", agent: "agent" },
				coverageTargets: coverage.coverageTargets,
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
				thresholds: coverage.thresholds,
				exclude: [
					"**/*.{test,spec}.ts",
					"packages/cli/src/bin.ts",
					"packages/cli/src/index.ts",
					"packages/reporter/src/index.ts",
					"packages/plugin/src/index.ts",
					"packages/cli/src/commands/**",
					"packages/cli/src/layers/**",
					"packages/sdk/src/services/*.ts",
					"packages/sdk/src/migrations/**",
					"packages/sdk/src/layers/OutputPipelineLive.ts",
					"packages/sdk/src/formatters/silent.ts",
				],
			},
		},
	});
};

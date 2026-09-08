import { AgentPlugin } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

export default async () => {
	const { projects, tags } = await AgentPlugin.discover();
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
					"**/reporter/src/index.ts",
					"**/plugin/src/index.ts",
					"**/cli/src/commands/**",
					"**/cli/src/layers/**",
					"**/sdk/src/services/*.ts",
					"**/sdk/src/migrations/**",
					"**/sdk/src/layers/OutputPipelineLive.ts",
					"**/sdk/src/formatters/silent.ts",
				],
			},
		},
	});
};

import { defineConfig } from "vitest/config";
import { AgentPlugin } from "vitest-agent-plugin";
import { createLiveInk, eventSourcedReporter } from "vitest-agent-ui";

export default async () => {
	const { projects, tags } = await AgentPlugin.discover();
	const live = createLiveInk();
	return defineConfig({
		plugins: [
			AgentPlugin({
				console: { human: "ink", agent: "agent" },
				reporter: eventSourcedReporter,
				onRunEvent: live.event,
				mcp: true,
				coverageThresholds: AgentPlugin.COVERAGE_LEVELS.basic,
				coverageTargets: AgentPlugin.COVERAGE_LEVELS.standard,
			}),
		],
		test: {
			projects,
			tags,
			pool: "forks",
			globalSetup: ["vitest.setup.ts"],
			coverage: {
				enabled: true,
				provider: "v8",
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

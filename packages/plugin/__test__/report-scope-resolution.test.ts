/**
 * Task 5: `report` option → `reportScope` resolution inside
 * `configureVitest`. Report files default ON for the machine-facing
 * executors (agent, ci) and OFF for a human at a terminal.
 */

import { EnvironmentDetectorTest } from "@vitest-agent/sdk";
import { describe, expect, it, vi } from "vitest";
import type { VitestPluginContext } from "vitest/node";
import { AgentPlugin } from "../src/plugin.js";
import { AgentReporter } from "../src/reporter.js";

function mockVitest() {
	return {
		config: { reporters: ["default" as unknown], coverage: {} },
		vite: { config: { cacheDir: "node_modules/.vite" } },
		onClose: vi.fn(),
	};
}

async function resolveScope(
	options: Parameters<typeof AgentPlugin>[0],
	env: "agent-shell" | "terminal" | "ci-github",
): Promise<string | undefined> {
	const plugin = AgentPlugin(options, EnvironmentDetectorTest.layer(env));
	const vitest = mockVitest();
	await plugin.configureVitest({
		vitest,
		project: { name: undefined },
		defineCacheKeyGenerator: vi.fn(),
	} as unknown as VitestPluginContext);
	const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
	return (reporter as unknown as { options: { reportScope?: string } }).options.reportScope;
}

describe("report scope resolution", () => {
	it("defaults to the vitest-agent scope for the agent executor", async () => {
		await expect(resolveScope({}, "agent-shell")).resolves.toBe("vitest-agent");
	});

	it("defaults to the vitest-agent scope for the ci executor", async () => {
		await expect(resolveScope({}, "ci-github")).resolves.toBe("vitest-agent");
	});

	it("defaults off for the human executor", async () => {
		await expect(resolveScope({}, "terminal")).resolves.toBeUndefined();
	});

	it("turns on for a human when the report option is set explicitly", async () => {
		await expect(resolveScope({ report: {} }, "terminal")).resolves.toBe("vitest-agent");
	});

	it("honours an explicit scope override", async () => {
		await expect(resolveScope({ report: { scope: "custom" } }, "agent-shell")).resolves.toBe("custom");
	});

	it("disables report files with report: false, even for the agent executor", async () => {
		await expect(resolveScope({ report: false }, "agent-shell")).resolves.toBeUndefined();
	});
});

/**
 * `configureVitest` wiring tests for the #194 remaining-scope fix: only the
 * agent executor with coverage enabled gets its `coverage.reportsDirectory`
 * rewritten to a per-process temp directory, and the two env-var overrides
 * are respected.
 */

import * as fs from "node:fs";
import { EnvironmentDetectorTest } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VitestPluginContext } from "vitest/node";
import { AgentPlugin } from "../src/plugin.js";

function mockVitest(coverageEnabled?: boolean) {
	const coverage: Record<string, unknown> = { reportsDirectory: "coverage" };
	if (coverageEnabled !== undefined) {
		coverage.enabled = coverageEnabled;
	}
	return {
		config: {
			reporters: ["default" as unknown],
			coverage,
		},
		vite: { config: { cacheDir: "node_modules/.vite" } },
		onClose: vi.fn(),
	};
}

async function callConfigureVitest(plugin: ReturnType<typeof AgentPlugin>, vitest: ReturnType<typeof mockVitest>) {
	const ctx = { vitest, project: { name: undefined } } as unknown as VitestPluginContext;
	await plugin.configureVitest(ctx);
}

describe("configureVitest coverage.reportsDirectory isolation (#194)", () => {
	beforeEach(() => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("rewrites reportsDirectory to a fresh, existing temp dir for the agent executor", async () => {
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		const rewritten = vitest.config.coverage.reportsDirectory as string;
		expect(rewritten).not.toBe("coverage");
		expect(fs.existsSync(rewritten)).toBe(true);
		expect(vitest.onClose).toHaveBeenCalledOnce();
	});

	it("leaves reportsDirectory untouched for the human executor", async () => {
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("terminal"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		expect(vitest.config.coverage.reportsDirectory).toBe("coverage");
		expect(vitest.onClose).not.toHaveBeenCalled();
	});

	it("leaves reportsDirectory untouched for the ci executor", async () => {
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("ci-github"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		expect(vitest.config.coverage.reportsDirectory).toBe("coverage");
		expect(vitest.onClose).not.toHaveBeenCalled();
	});

	it("leaves reportsDirectory untouched when the opt-out env var is set", async () => {
		vi.stubEnv("VITEST_AGENT_COVERAGE_DIR_ISOLATION", "off");
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		expect(vitest.config.coverage.reportsDirectory).toBe("coverage");
		expect(vitest.onClose).not.toHaveBeenCalled();
	});

	it("uses the explicit VITEST_AGENT_COVERAGE_DIR verbatim without creating or registering cleanup", async () => {
		vi.stubEnv("VITEST_AGENT_COVERAGE_DIR", "/tmp/explicit-vitest-agent-cov-dir");
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		expect(vitest.config.coverage.reportsDirectory).toBe("/tmp/explicit-vitest-agent-cov-dir");
		expect(vitest.onClose).not.toHaveBeenCalled();
	});
});

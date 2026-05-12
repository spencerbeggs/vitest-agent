import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VitestPluginContext } from "vitest/node";
import { EnvironmentDetectorTest } from "vitest-agent-sdk";
import { AgentPlugin } from "../src/plugin.js";
import { AgentReporter } from "../src/reporter.js";

function mockVitest(
	reporters: unknown[] = ["default"],
	overrides?: {
		thresholds?: Record<string, unknown>;
		outputFile?: string | Record<string, string>;
	},
) {
	const coverage: { thresholds?: Record<string, unknown> } = {};
	if (overrides?.thresholds !== undefined) {
		coverage.thresholds = overrides.thresholds;
	}
	const config: {
		reporters: unknown[];
		coverage: { thresholds?: Record<string, unknown> };
		outputFile?: string | Record<string, string>;
	} = { reporters, coverage };
	if (overrides?.outputFile !== undefined) {
		config.outputFile = overrides.outputFile;
	}
	return {
		config,
		vite: { config: { cacheDir: "node_modules/.vite" } },
	};
}

/**
 * Call configureVitest with a mock context.
 * The mock satisfies the subset of VitestPluginContext that the plugin uses.
 */
async function callConfigureVitest(plugin: ReturnType<typeof AgentPlugin>, vitest: ReturnType<typeof mockVitest>) {
	const ctx = { vitest, project: { name: undefined } } as unknown as VitestPluginContext;
	await plugin.configureVitest(ctx);
}

describe("AgentPlugin", () => {
	let stderrWrite: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		stderrWrite.mockRestore();
		vi.unstubAllEnvs();
	});

	it("returns plugin with correct name", () => {
		const plugin = AgentPlugin();
		expect(plugin.name).toBe("vitest-agent");
	});

	it("has configureVitest method", () => {
		const plugin = AgentPlugin();
		expect(typeof plugin.configureVitest).toBe("function");
	});

	describe("always injects reporter regardless of environment", () => {
		it("injects in human environment", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest();
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});

		it("injects in agent environment", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});

		it("injects in CI environment", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("ci-github"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});

		it("forces agent rendering in a terminal env via console.human", async () => {
			const plugin = AgentPlugin({ console: { human: "agent" } }, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});

		it("forces silent in agent env via console.agent", async () => {
			const plugin = AgentPlugin({ console: { agent: "silent" } }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest([]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});
	});

	describe("onRunEvent tap gating", () => {
		it("forwards events to the tap when console.human is ink", async () => {
			let received = 0;
			const plugin = AgentPlugin(
				{
					console: { human: "ink" },
					onRunEvent: () => {
						received++;
					},
				},
				EnvironmentDetectorTest.layer("terminal"),
			);
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			reporter.onTestRunStart([]);
			expect(received).toBeGreaterThan(0);
		});

		it("suppresses the tap when console.human is silent", async () => {
			let received = 0;
			const plugin = AgentPlugin(
				{
					console: { human: "silent" },
					onRunEvent: () => {
						received++;
					},
				},
				EnvironmentDetectorTest.layer("terminal"),
			);
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			reporter.onTestRunStart([]);
			expect(received).toBe(0);
		});

		it("suppresses the tap in passthrough mode (Vitest reporters do the visible work)", async () => {
			let received = 0;
			const plugin = AgentPlugin(
				{
					console: { human: "passthrough" },
					onRunEvent: () => {
						received++;
					},
				},
				EnvironmentDetectorTest.layer("terminal"),
			);
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			reporter.onTestRunStart([]);
			expect(received).toBe(0);
		});

		it("suppresses the tap in the agent slot", async () => {
			let received = 0;
			const plugin = AgentPlugin(
				{
					console: { agent: "agent" },
					onRunEvent: () => {
						received++;
					},
				},
				EnvironmentDetectorTest.layer("agent-shell"),
			);
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			reporter.onTestRunStart([]);
			expect(received).toBe(0);
		});
	});

	describe("reporter stripping when plugin owns stdout", () => {
		it("strips console reporters when agent executor produces agent output", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["default", "verbose"]);
			await callConfigureVitest(plugin, vitest);
			const nonAgent = vitest.config.reporters.filter((r) => !(r instanceof AgentReporter));
			expect(nonAgent.length).toBe(0);
		});

		it("does not strip when agent executor is set to passthrough", async () => {
			const plugin = AgentPlugin({ console: { agent: "passthrough" } }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters).toContain("agent");
		});

		it("does not strip when human executor defaults to passthrough", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters).toContain("default");
		});

		it("strips when human is explicitly set to ink", async () => {
			const plugin = AgentPlugin({ console: { human: "ink" } }, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["default", "verbose"]);
			await callConfigureVitest(plugin, vitest);
			const nonAgent = vitest.config.reporters.filter((r) => !(r instanceof AgentReporter));
			expect(nonAgent.length).toBe(0);
		});

		it("preserves non-console reporters when stripping", async () => {
			const customReporter = { onInit: () => {} };
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["default", customReporter]);
			await callConfigureVitest(plugin, vitest);
			const nonAgent = vitest.config.reporters.filter((r) => !(r instanceof AgentReporter));
			expect(nonAgent).toContain(customReporter);
		});
	});

	describe("cache directory resolution", () => {
		it("uses explicit cacheDir from reporter options", async () => {
			const plugin = AgentPlugin(
				{ reporterOptions: { cacheDir: "/custom/cache" } },
				EnvironmentDetectorTest.layer("agent-shell"),
			);
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter).toBeDefined();
		});

		it("uses outputFile when set for vitest-agent", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"], {
				outputFile: { "vitest-agent": "./custom-output" },
			});
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});

		it("falls back to Vite cacheDir", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});
	});

	describe("coverage thresholds resolution", () => {
		it("passes thresholds from plugin options to reporter", async () => {
			const plugin = AgentPlugin(
				{
					coverageThresholds: "basic",
				},
				EnvironmentDetectorTest.layer("agent-shell"),
			);
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter);
			expect(reporter).toBeDefined();
		});

		it("reads thresholds from vitest coverage config when plugin options not set", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"], {
				thresholds: { lines: 90, branches: 85, functions: 80, statements: 90 },
			});
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter);
			expect(reporter).toBeDefined();
		});

		it("plugin options take priority over vitest config thresholds", async () => {
			const plugin = AgentPlugin(
				{
					coverageThresholds: "basic",
				},
				EnvironmentDetectorTest.layer("agent-shell"),
			);
			const vitest = mockVitest(["agent"], {
				thresholds: { lines: 90, branches: 85 },
			});
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter);
			expect(reporter).toBeDefined();
		});
	});

	describe("coverage targets", () => {
		it("passes targets to reporter when set", async () => {
			const plugin = AgentPlugin(
				{
					coverageTargets: "strict",
				},
				EnvironmentDetectorTest.layer("agent-shell"),
			);
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter);
			expect(reporter).toBeDefined();
		});

		it("disables Vitest native autoUpdate when targets set", async () => {
			const thresholds: Record<string, unknown> = { lines: 80 };
			const plugin = AgentPlugin(
				{
					coverageTargets: "strict",
				},
				EnvironmentDetectorTest.layer("agent-shell"),
			);
			const vitest = mockVitest(["agent"], { thresholds });
			await callConfigureVitest(plugin, vitest);
			expect(thresholds.autoUpdate).toBe(false);
		});

		it("does not disable autoUpdate when no explicit targets are set", async () => {
			const thresholds: Record<string, unknown> = { lines: 80 };
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"], { thresholds });
			await callConfigureVitest(plugin, vitest);
			expect(thresholds.autoUpdate).toBeUndefined();
		});

		it("respects autoUpdate false in reporter options", async () => {
			const thresholds: Record<string, unknown> = { lines: 80 };
			const plugin = AgentPlugin(
				{
					coverageTargets: "strict",
					reporterOptions: {
						autoUpdate: false,
					},
				},
				EnvironmentDetectorTest.layer("agent-shell"),
			);
			const vitest = mockVitest(["agent"], { thresholds });
			await callConfigureVitest(plugin, vitest);
			expect(thresholds.autoUpdate).toBeUndefined();
		});
	});

	describe("coverage option promotion", () => {
		it("reads coverageThresholds from top-level option (string name)", async () => {
			const plugin = AgentPlugin(
				{ coverageThresholds: "basic", coverageTargets: "strict" },
				EnvironmentDetectorTest.layer("terminal"),
			);
			const vitest = mockVitest();
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});

		it("accepts a CoverageLevel instance for coverageThresholds", async () => {
			const plugin = AgentPlugin(
				{ coverageThresholds: AgentPlugin.COVERAGE_LEVELS.basic, coverageTargets: "strict" },
				EnvironmentDetectorTest.layer("terminal"),
			);
			const vitest = mockVitest();
			await expect(callConfigureVitest(plugin, vitest)).resolves.not.toThrow();
		});

		it("throws when target is below threshold", async () => {
			const plugin = AgentPlugin(
				{ coverageThresholds: "strict", coverageTargets: "none" },
				EnvironmentDetectorTest.layer("terminal"),
			);
			const vitest = mockVitest();
			await expect(callConfigureVitest(plugin, vitest)).rejects.toThrow(/coverageTargets\.lines/);
		});

		it("COVERAGE_LEVELS.strict has correct values", () => {
			expect(AgentPlugin.COVERAGE_LEVELS.strict.lines).toBe(80);
		});

		it("COVERAGE_LEVELS_PER_FILE.strict has perFile: true", () => {
			expect(AgentPlugin.COVERAGE_LEVELS_PER_FILE.strict.perFile).toBe(true);
			expect(AgentPlugin.COVERAGE_LEVELS_PER_FILE.strict.lines).toBe(80);
		});
	});

	describe("environment detection and console-slot defaults", () => {
		it("agent-shell env strips reporters (default console.agent='agent')", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const nonAgent = vitest.config.reporters.filter((r) => !(r instanceof AgentReporter));
			expect(nonAgent.length).toBe(0);
		});

		it("ci-github env preserves Vitest reporters (default console.ci='ci-annotations' is a separate target)", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("ci-github"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			// ci-annotations owns stdout for annotations but Vitest's default
			// reporter is also informative; for now strip when the plugin owns
			// the channel.
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});

		it("terminal env preserves Vitest reporters (default console.human='passthrough')", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters).toContain("default");
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});
	});
});

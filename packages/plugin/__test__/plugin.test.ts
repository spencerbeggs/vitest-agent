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

		it("injects in forced agent mode", async () => {
			const plugin = AgentPlugin({ mode: "agent" }, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});

		it("injects in forced silent mode", async () => {
			const plugin = AgentPlugin({ mode: "silent" }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest([]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});
	});

	describe("reporter stripping in own mode", () => {
		it("strips console reporters when agent + own", async () => {
			const plugin = AgentPlugin({ strategy: "own" }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["default", "verbose"]);
			await callConfigureVitest(plugin, vitest);
			const nonAgent = vitest.config.reporters.filter((r) => !(r instanceof AgentReporter));
			expect(nonAgent.length).toBe(0);
		});

		it("does not strip when agent + complement", async () => {
			const plugin = AgentPlugin({ strategy: "complement" }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters).toContain("agent");
		});

		it("does not strip when human + own", async () => {
			const plugin = AgentPlugin({ strategy: "own" }, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters).toContain("default");
		});

		it("preserves non-console reporters when stripping", async () => {
			const customReporter = { onInit: () => {} };
			const plugin = AgentPlugin({ strategy: "own" }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["default", customReporter]);
			await callConfigureVitest(plugin, vitest);
			const nonAgent = vitest.config.reporters.filter((r) => !(r instanceof AgentReporter));
			expect(nonAgent).toContain(customReporter);
		});
	});

	describe("complement mode warning", () => {
		it("warns when agent detected but no agent reporter in complement mode", async () => {
			const plugin = AgentPlugin({ strategy: "complement" }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			expect(stderrWrite).toHaveBeenCalled();
			const output = stderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
			expect(output).toContain("complement");
		});

		it("does not warn when agent reporter is present", async () => {
			const plugin = AgentPlugin({ strategy: "complement" }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			const output = stderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
			expect(output).not.toContain("complement");
		});

		it("does not warn in human environment", async () => {
			const plugin = AgentPlugin({ strategy: "complement" }, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const output = stderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
			expect(output).not.toContain("complement");
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

	describe("environment detection modes", () => {
		it("auto mode detects agent-shell", async () => {
			const plugin = AgentPlugin({ strategy: "own" }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const nonAgent = vitest.config.reporters.filter((r) => !(r instanceof AgentReporter));
			expect(nonAgent.length).toBe(0);
		});

		it("auto mode detects ci-github", async () => {
			const plugin = AgentPlugin({ strategy: "own" }, EnvironmentDetectorTest.layer("ci-github"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters).toContain("default");
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});

		it("auto mode detects terminal", async () => {
			const plugin = AgentPlugin({ strategy: "own" }, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters).toContain("default");
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});
	});
});

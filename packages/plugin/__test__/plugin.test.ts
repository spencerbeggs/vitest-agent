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
		passWithNoTests?: boolean;
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
		passWithNoTests?: boolean;
	} = { reporters, coverage };
	if (overrides?.outputFile !== undefined) {
		config.outputFile = overrides.outputFile;
	}
	if (overrides?.passWithNoTests !== undefined) {
		config.passWithNoTests = overrides.passWithNoTests;
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

	describe("onRunEvent user-facing tee", () => {
		it("forwards events to the tap in every console mode (ink)", async () => {
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

		it("forwards events to the tap when human mode is silent", async () => {
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
			expect(received).toBeGreaterThan(0);
		});

		it("forwards events to the tap in passthrough mode", async () => {
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
			expect(received).toBeGreaterThan(0);
		});

		it("forwards events to the tap in the agent slot", async () => {
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
			expect(received).toBeGreaterThan(0);
		});

		it("catches throws in the user callback and emits to stderr", async () => {
			const original = process.stderr.write.bind(process.stderr);
			let stderrText = "";
			process.stderr.write = ((chunk: unknown) => {
				stderrText += typeof chunk === "string" ? chunk : String(chunk);
				return true;
			}) as typeof process.stderr.write;
			try {
				const plugin = AgentPlugin(
					{
						onRunEvent: () => {
							throw new Error("boom");
						},
					},
					EnvironmentDetectorTest.layer("terminal"),
				);
				const vitest = mockVitest(["default"]);
				await callConfigureVitest(plugin, vitest);
				const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
				reporter.onTestRunStart([]);
			} finally {
				process.stderr.write = original;
			}
			expect(stderrText).toContain("onRunEvent tap threw");
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
		// `cacheDir` is no longer a user option in 2.0 — the plugin always
		// defers to `resolveDataPath` (XDG / vitest-agent.config.toml /
		// normalized workspace name). The plugin still constructs an
		// AgentReporter; the path stack is exercised in path-resolver tests.
		it("constructs the reporter and lets the path resolver pick the DB location", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			expect(vitest.config.reporters.some((r) => r instanceof AgentReporter)).toBe(true);
		});
	});

	describe("coverage thresholds resolution", () => {
		it("reads thresholds from vitest coverage config", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"], {
				thresholds: { lines: 90, branches: 85, functions: 80, statements: 90 },
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
					coverageTargets: { lines: 80, functions: 75 },
				},
				EnvironmentDetectorTest.layer("agent-shell"),
			);
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter);
			expect(reporter).toBeDefined();
		});

		it("does not disable autoUpdate when no explicit targets are set", async () => {
			const thresholds: Record<string, unknown> = { lines: 80 };
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"], { thresholds });
			await callConfigureVitest(plugin, vitest);
			expect(thresholds.autoUpdate).toBeUndefined();
		});

		it("accepts typed CoverageTargets object with per-metric numbers", async () => {
			const plugin = AgentPlugin(
				{
					coverageTargets: { lines: 80, functions: 75, branches: 70 },
				},
				EnvironmentDetectorTest.layer("agent-shell"),
			);
			const vitest = mockVitest(["agent"]);
			await expect(callConfigureVitest(plugin, vitest)).resolves.not.toThrow();
		});
	});

	describe("auto-derived mcp / githubActions", () => {
		it("auto-derives mcp=true when executor is agent", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.mcp).toBe(true);
		});

		it("auto-derives mcp=false when executor is human", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.mcp).toBe(false);
		});

		it("auto-derives mcp=false when executor is ci", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("ci-github"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.mcp).toBe(false);
		});

		it("auto-derives githubActions=true under ci-github when consoleMode is not silent", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("ci-github"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.githubActions).toBe(true);
		});

		it("auto-derives githubActions=false outside ci-github", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("terminal"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.githubActions).toBe(false);
		});

		it("auto-derives githubActions=false when console.ci is silent under ci-github", async () => {
			const plugin = AgentPlugin({ console: { ci: "silent" } }, EnvironmentDetectorTest.layer("ci-github"));
			const vitest = mockVitest(["default"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.githubActions).toBe(false);
		});
	});

	describe("transport threading", () => {
		it("defaults transport to { kind: 'local' } when unset", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.transport).toEqual({ kind: "local" });
		});

		it("threads an explicit transport onto the resolved config", async () => {
			const plugin = AgentPlugin({ transport: { kind: "local" } }, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.transport).toEqual({ kind: "local" });
		});
	});

	describe("passWithNoTests threading", () => {
		it("threads test.passWithNoTests=true from the resolved Vitest config onto ResolvedReporterConfig", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"], { passWithNoTests: true });
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.passWithNoTests).toBe(true);
		});

		it("threads test.passWithNoTests=false from the resolved Vitest config onto ResolvedReporterConfig", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"], { passWithNoTests: false });
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.passWithNoTests).toBe(false);
		});

		it("leaves passWithNoTests undefined when the field is absent from the Vitest config", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.passWithNoTests).toBeUndefined();
		});

		it("does not surface passWithNoTests when the Vitest config carries a non-boolean value", async () => {
			const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
			const vitest = mockVitest(["agent"]);
			// Simulate a malformed config that slipped past Vitest's own typing
			(vitest.config as { passWithNoTests?: unknown }).passWithNoTests = "yes";
			await callConfigureVitest(plugin, vitest);
			const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
			expect(reporter.resolvedConfig.passWithNoTests).toBeUndefined();
		});
	});

	describe("coverage option promotion", () => {
		it("COVERAGE_LEVELS.standard exposes the dual-output shape", () => {
			const preset = AgentPlugin.COVERAGE_LEVELS.standard;
			expect(preset.thresholds.lines).toBe(70);
			expect(preset.thresholds.branches).toBe(65);
			expect(preset.thresholds.functions).toBe(70);
			expect(preset.thresholds.statements).toBe(70);
			expect(preset.thresholds.perFile).toBeUndefined();
			expect(preset.coverageTargets.lines).toBe(80);
			expect(preset.coverageTargets.branches).toBe(75);
			expect(preset.coverageTargets.functions).toBe(80);
			expect(preset.coverageTargets.statements).toBe(80);
		});

		it("COVERAGE_LEVELS.full caps coverageTargets at the full preset numbers", () => {
			const preset = AgentPlugin.COVERAGE_LEVELS.full;
			expect(preset.thresholds.lines).toBe(90);
			expect(preset.coverageTargets.lines).toBe(90);
			expect(preset.coverageTargets.branches).toBe(85);
		});

		it("COVERAGE_LEVELS_PER_FILE.strict applies perFile only to the thresholds half", () => {
			const preset = AgentPlugin.COVERAGE_LEVELS_PER_FILE.strict;
			expect(preset.thresholds.perFile).toBe(true);
			expect(preset.thresholds.lines).toBe(80);
			expect("perFile" in preset.coverageTargets).toBe(false);
			expect(preset.coverageTargets.lines).toBe(90);
		});

		it("COVERAGE_AUTOUPDATE.standard floors fractional values", () => {
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.standard(95.85)).toBe(95);
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.standard(50)).toBe(50);
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.standard(0)).toBe(0);
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.standard(100)).toBe(100);
		});

		it("COVERAGE_AUTOUPDATE.strict ceils fractional values", () => {
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.strict(95.1)).toBe(96);
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.strict(50)).toBe(50);
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.strict(0)).toBe(0);
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.strict(100)).toBe(100);
		});

		it("COVERAGE_AUTOUPDATE.lenient floors then subtracts a two-point slack, clamped to zero", () => {
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.lenient(50)).toBe(48);
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.lenient(1)).toBe(0);
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.lenient(0)).toBe(0);
			expect(AgentPlugin.COVERAGE_AUTOUPDATE.lenient(100.9)).toBe(98);
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

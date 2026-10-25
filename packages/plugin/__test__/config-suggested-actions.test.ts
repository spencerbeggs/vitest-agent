/**
 * Issue #544 (items 2 and 5): `ConfigValidation` warnings reach the agent
 * as suggested actions, not only the human on stderr.
 *
 * Two layers: the pure mapper from a `ValidationResult` onto
 * `SuggestedActionRecord`s, and the plugin lifecycle — `configureVitest`
 * with a coverage-config mismatch feeds `ReporterRenderInput.suggestedActions`
 * so the default reporter's agent output carries an `Actions:` trailer,
 * while the stderr warning line still prints for a human. UI-only mode
 * (`coverage.enabled: false`) keeps the run DB-free; the target/threshold
 * rules run in both modes.
 */

import { EnvironmentDetectorTest } from "@vitest-agent/engine";
import type { SuggestedActionRecord, VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VitestPluginContext } from "vitest/node";
import { AgentPlugin } from "../src/plugin.js";
import { AgentReporter } from "../src/reporter.js";
import {
	CONFIG_SUGGESTED_ACTIONS_SYMBOL,
	publishConfigSuggestedActions,
	suggestedActionsFromValidation,
} from "../src/utils/config-suggested-actions.js";

describe("suggestedActionsFromValidation", () => {
	it("maps a warning to a warn action titled by its code, with the remediation appended to the detail", () => {
		const actions = suggestedActionsFromValidation({
			errors: [],
			warnings: [{ code: "GITHUB_JOB_SUMMARY_COLLISION", message: "Both summaries appear.", remediation: "Drop one." }],
			info: [],
		});
		expect(actions).toEqual([
			{
				severity: "warn",
				title: "Coverage config: GITHUB_JOB_SUMMARY_COLLISION",
				detail: "Both summaries appear. Drop one.",
			},
		]);
	});

	it("keeps the detail to the message when a warning has no remediation, and maps info entries to info actions", () => {
		const actions = suggestedActionsFromValidation({
			errors: [],
			warnings: [{ code: "TARGET_WITHOUT_THRESHOLD", message: "lines is set but no threshold." }],
			info: [{ code: "NOTE", message: "fyi" }],
		});
		expect(actions).toEqual([
			{
				severity: "warn",
				title: "Coverage config: TARGET_WITHOUT_THRESHOLD",
				detail: "lines is set but no threshold.",
			},
			{ severity: "info", title: "Coverage config: NOTE", detail: "fyi" },
		]);
		// No action names a tool: nothing in the MCP surface edits the config.
		expect(actions.every((a) => a.targetTool === undefined)).toBe(true);
	});

	it("ignores errors (they throw at config time) and yields nothing for a clean result", () => {
		expect(
			suggestedActionsFromValidation({
				errors: [{ code: "TARGET_BELOW_THRESHOLD", message: "x" }],
				warnings: [],
				info: [],
			}),
		).toEqual([]);
	});

	it("publishes a non-empty list on the Vitest instance under the Symbol.for slot and clears it for an empty one", () => {
		const vitest: Record<symbol, unknown> = {};
		const actions: SuggestedActionRecord[] = [{ severity: "warn", title: "t", detail: "d" }];
		publishConfigSuggestedActions(vitest, actions);
		expect(vitest[Symbol.for("vitest-agent:config-suggested-actions")]).toBe(actions);
		publishConfigSuggestedActions(vitest, []);
		expect(vitest[CONFIG_SUGGESTED_ACTIONS_SYMBOL]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

function mockVitest(thresholds?: Record<string, unknown>) {
	const coverage: Record<string, unknown> = { enabled: false };
	if (thresholds !== undefined) coverage.thresholds = thresholds;
	return {
		config: { reporters: ["default" as unknown], coverage },
		vite: { config: { cacheDir: "node_modules/.vite" } },
		onClose: vi.fn(),
	};
}

async function callConfigureVitest(plugin: ReturnType<typeof AgentPlugin>, vitest: ReturnType<typeof mockVitest>) {
	const ctx = {
		vitest,
		project: { name: undefined },
		defineCacheKeyGenerator: vi.fn(),
	} as unknown as VitestPluginContext;
	await plugin.configureVitest(ctx);
}

function makeTestModule(): VitestTestModule {
	const test: VitestTestCase = {
		type: "test",
		name: "a test",
		fullName: "a test",
		tags: [],
		result: () => ({ state: "passed" }),
		diagnostic: () => ({ duration: 10, flaky: false, slow: false }),
	};
	return {
		type: "module",
		moduleId: "/abs/src/foo.test.ts",
		relativeModuleId: "src/foo.test.ts",
		project: { name: "" },
		state: () => "passed",
		children: {
			*allTests() {
				yield test;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 50 }),
		errors: () => [],
	};
}

describe("ConfigValidation warnings reach the rendered agent output (issue #544)", () => {
	let stderrWrite: ReturnType<typeof vi.spyOn>;
	let stdoutWrite: ReturnType<typeof vi.spyOn>;
	const stderrText = () => stderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
	const stdoutText = () => stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");

	beforeEach(() => {
		stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		stderrWrite.mockRestore();
		stdoutWrite.mockRestore();
	});

	async function runWith(vitest: ReturnType<typeof mockVitest>) {
		// agent-shell → executor agent → consoleMode "agent": the default
		// reporter renders the one-shot agent frame to stdout.
		const plugin = AgentPlugin({ coverageTargets: { lines: 80 } }, EnvironmentDetectorTest.layer("agent-shell"));
		await callConfigureVitest(plugin, vitest);
		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter).toBeDefined();
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([makeTestModule()], [], "passed");
		return reporter;
	}

	it("a coverageTargets metric with no coverage.thresholds floor yields a suggested action in the agent output and keeps the stderr line", async () => {
		const vitest = mockVitest(/* no thresholds */);
		await runWith(vitest);

		const out = stdoutText();
		expect(out).toContain("Actions:");
		expect(out).toContain("Coverage config: TARGET_WITHOUT_THRESHOLD");
		expect(out).toContain("coverage.thresholds.lines is not configured");

		// The human audience still gets the stderr diagnostic.
		expect(stderrText()).toContain("[vitest-agent:plugin] warning TARGET_WITHOUT_THRESHOLD");

		// And the MCP handshake slot carries the same action.
		const published = (vitest as unknown as Record<symbol, unknown>)[CONFIG_SUGGESTED_ACTIONS_SYMBOL];
		expect(published).toEqual([
			expect.objectContaining({ severity: "warn", title: "Coverage config: TARGET_WITHOUT_THRESHOLD" }),
		]);
	});

	it("a matching coverage.thresholds floor yields no suggested action, no Actions trailer and no stderr warning", async () => {
		const vitest = mockVitest({ lines: 80 });
		await runWith(vitest);

		const out = stdoutText();
		expect(out).not.toBe("");
		expect(out).not.toContain("Actions:");
		expect(stderrText()).not.toContain("warning TARGET_WITHOUT_THRESHOLD");
		expect((vitest as unknown as Record<symbol, unknown>)[CONFIG_SUGGESTED_ACTIONS_SYMBOL]).toBeUndefined();
	});

	it("a custom reporter receives the actions on ReporterRenderInput.suggestedActions", async () => {
		const render = vi.fn(() => []);
		const plugin = AgentPlugin(
			{ coverageTargets: { lines: 80 }, reporter: () => ({ render }) },
			EnvironmentDetectorTest.layer("agent-shell"),
		);
		const vitest = mockVitest();
		await callConfigureVitest(plugin, vitest);
		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([makeTestModule()], [], "passed");

		expect(render).toHaveBeenCalledOnce();
		const [input] = render.mock.calls[0] as unknown as [{ suggestedActions?: ReadonlyArray<SuggestedActionRecord> }];
		expect(input.suggestedActions).toEqual([
			{
				severity: "warn",
				title: "Coverage config: TARGET_WITHOUT_THRESHOLD",
				detail: expect.stringContaining("coverage.thresholds.lines is not configured"),
			},
		]);
	});
});

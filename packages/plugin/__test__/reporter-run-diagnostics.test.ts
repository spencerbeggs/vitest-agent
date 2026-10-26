/**
 * Issue #544: `onTestRunEnd` assembles the run's diagnostics (performance
 * hints, post-run timing, persistence status), hands them to every reporter
 * on `ReporterRenderInput.runDiagnostics`, appends their suggested actions
 * after the config-time ones, and publishes them on the Vitest instance for
 * the MCP `run_tests` tool.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ReporterRenderInput,
	RunDiagnostics,
	SuggestedActionRecord,
	VitestTestCase,
	VitestTestModule,
} from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentReporterConstructorOptions } from "../src/reporter.js";
import { AgentReporter } from "../src/reporter.js";
import { RUN_DIAGNOSTICS_SYMBOL } from "../src/utils/run-diagnostics.js";

const module = (name: string, project = ""): VitestTestModule => {
	const test: VitestTestCase = {
		type: "test",
		name: `${name} test`,
		fullName: `${name} test`,
		tags: [],
		result: () => ({ state: "passed" }),
		diagnostic: () => ({ duration: 1, flaky: false, slow: false }),
	};
	return {
		type: "module",
		moduleId: `/abs/src/${name}.test.ts`,
		relativeModuleId: `src/${name}.test.ts`,
		project: { name: project },
		state: () => "passed",
		children: {
			*allTests() {
				yield test;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 1 }),
		errors: () => [],
	};
};

const slot = (vitest: object): unknown => (vitest as Record<symbol, unknown>)[RUN_DIAGNOSTICS_SYMBOL];

let tmp: string;
let stderr: string[];
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "vitest-agent-run-diag-"));
	stderr = [];
	vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
		stderr.push(String(chunk));
		return true;
	}) as typeof process.stderr.write);
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(tmp, { recursive: true, force: true });
});

const makeReporter = (options: Partial<AgentReporterConstructorOptions> = {}) => {
	const inputs: ReporterRenderInput[] = [];
	const reporter = new AgentReporter({
		cacheDir: tmp,
		consoleMode: "silent",
		reporter: () => ({
			render: (input: ReporterRenderInput) => {
				inputs.push(input);
				return [];
			},
		}),
		...options,
	});
	return { reporter, inputs };
};

/** A cache dir that cannot be created: a regular file sits where a directory is needed. */
const blockedCacheDir = (): string => {
	const blocker = join(tmp, "blocker");
	writeFileSync(blocker, "a file, not a directory");
	return join(blocker, "nested");
};

const config: SuggestedActionRecord = { severity: "warn", title: "Coverage config: X", detail: "fix it" };

describe("AgentReporter run diagnostics (#544)", () => {
	it("hands numeric post-run timing and an ok persistence status to the renderer", async () => {
		const { reporter, inputs } = makeReporter();
		await reporter.onInit({});
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");

		const d = inputs[0]?.runDiagnostics;
		expect(d).toBeDefined();
		expect(d?.performanceHints).toEqual([]);
		expect(d?.persistence).toEqual({ ok: true });
		expect(typeof d?.postRun?.persistMs).toBe("number");
		expect(typeof d?.postRun?.coverageScanMs).toBe("number");
		expect(d?.postRun?.totalMs).toBeCloseTo((d?.postRun?.persistMs ?? 0) + (d?.postRun?.coverageScanMs ?? 0));
		expect(typeof d?.postRun?.vitestDurationMs).toBe("number");
	});

	it("reports a failed persistence and appends a 'Results were not saved' action after the config actions", async () => {
		const { reporter, inputs } = makeReporter({ cacheDir: blockedCacheDir(), suggestedActions: [config] });
		await reporter.onInit({});
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");

		const input = inputs[0];
		expect(input?.runDiagnostics?.persistence?.ok).toBe(false);
		expect(input?.runDiagnostics?.persistence?.reason).toBeTruthy();
		// A path problem, not a schema one: no db-reset remedy.
		expect(input?.runDiagnostics?.persistence?.migrationFailed).toBeUndefined();
		expect(input?.suggestedActions?.[0]).toEqual(config);
		expect(input?.suggestedActions?.[1]).toMatchObject({ severity: "warn", title: "Results were not saved" });
		// The existing human-facing stderr line stays.
		expect(stderr.join("")).toContain("NOT recorded");
	});

	it("omits persistence and the not-saved action when persist is false", async () => {
		const { reporter, inputs } = makeReporter({ persist: false });
		await reporter.onInit({});
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");

		const d = inputs[0]?.runDiagnostics;
		expect(d).toBeDefined();
		expect(d !== undefined && "persistence" in d).toBe(false);
		expect(d?.postRun?.persistMs).toBe(0);
		expect(inputs[0]?.suggestedActions ?? []).not.toContainEqual(
			expect.objectContaining({ title: "Results were not saved" }),
		);
	});

	it("omits suggestedActions when there are neither config nor diagnostic actions", async () => {
		const { reporter, inputs } = makeReporter();
		await reporter.onInit({});
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");
		expect(inputs[0] !== undefined && "suggestedActions" in inputs[0]).toBe(false);
	});

	it("publishes the diagnostics, including renderMs, on the Vitest instance", async () => {
		const vitest = {};
		const { reporter } = makeReporter({ cacheDir: blockedCacheDir() });
		await reporter.onInit(vitest);
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");

		const published = slot(vitest) as RunDiagnostics | undefined;
		expect(published?.persistence?.ok).toBe(false);
		expect(typeof published?.postRun?.renderMs).toBe("number");
	});

	it("leaves the slot untouched for a reporter filtered to a non-primary project", async () => {
		const sentinel = { performanceHints: [], persistence: { ok: false, reason: "prior" } };
		const vitest: Record<symbol, unknown> = { [RUN_DIAGNOSTICS_SYMBOL]: sentinel };
		const { reporter, inputs } = makeReporter({ cacheDir: blockedCacheDir(), projectFilter: "minor" });
		await reporter.onInit(vitest);
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a", "major"), module("b", "major"), module("c", "minor")], [], "passed");

		expect(inputs).toHaveLength(1);
		expect(inputs[0]?.runDiagnostics).toBeUndefined();
		expect(slot(vitest)).toBe(sentinel);
	});

	it("clears the slot on a later run whose diagnostics are clean", async () => {
		const vitest = {};
		const cacheDir = blockedCacheDir();
		const { reporter } = makeReporter({ cacheDir });
		await reporter.onInit(vitest);
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");
		expect(slot(vitest)).toBeDefined();

		// Fix the cache dir; the watch rerun persists cleanly.
		rmSync(join(tmp, "blocker"));
		mkdirSync(cacheDir, { recursive: true });
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");
		expect(slot(vitest)).toBeUndefined();
	});
});

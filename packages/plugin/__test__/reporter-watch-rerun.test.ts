/**
 * Watch-mode reruns keep one `AgentReporter` instance alive across runs.
 * The `onTestRunEnd` idempotence guard (which stops Vitest's repeated
 * `onTestRunEnd` within ONE run from double-rendering) must therefore be
 * re-armed by `onTestRunStart`, or the second and later watch runs would
 * silently skip rendering, persistence and the `RunFinished` emit
 * (issue #576).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReporterRenderInput, RunEvent, VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentReporter } from "../src/reporter.js";

const module = (name: string, state: "passed" | "failed" = "passed"): VitestTestModule => {
	const test: VitestTestCase = {
		type: "test",
		name: `${name} test`,
		fullName: `${name} test`,
		tags: [],
		result: () =>
			state === "passed" ? { state } : { state, errors: [{ message: `${name} boom`, name: "AssertionError" }] },
		diagnostic: () => ({ duration: 1, flaky: false, slow: false }),
	};
	return {
		type: "module",
		moduleId: `/abs/src/${name}.test.ts`,
		relativeModuleId: `src/${name}.test.ts`,
		project: { name: "" },
		state: () => state,
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

let cacheDir: string;
beforeEach(() => {
	cacheDir = mkdtempSync(join(tmpdir(), "vitest-agent-rerun-"));
});
afterEach(() => {
	rmSync(cacheDir, { recursive: true, force: true });
});

const makeReporter = () => {
	const render = vi.fn((_input: ReporterRenderInput) => []);
	const events: RunEvent[] = [];
	const reporter = new AgentReporter({
		cacheDir,
		consoleMode: "silent",
		coverageMode: "ui-only",
		reporter: () => ({ render }),
		onRunEvent: (e) => events.push(e),
	});
	return { reporter, render, events };
};

const runFinishedCount = (events: ReadonlyArray<RunEvent>) => events.filter((e) => e._tag === "RunFinished").length;

describe("AgentReporter across watch-mode reruns (#576)", () => {
	it("renders and emits RunFinished on the second run of one reporter instance", async () => {
		const { reporter, render, events } = makeReporter();
		await reporter.onInit({});

		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("first")], [], "passed");
		expect(render).toHaveBeenCalledTimes(1);
		expect(runFinishedCount(events)).toBe(1);

		// Vitest reuses the same reporter instance for the watch rerun.
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("second", "failed")], [], "failed");
		expect(render).toHaveBeenCalledTimes(2);
		expect(runFinishedCount(events)).toBe(2);

		// The second render saw the second run's results, not a stale report:
		// a passing report names no tests, so the second run fails one.
		const firstReports = render.mock.calls[0]?.[0].reports ?? [];
		const secondReports = render.mock.calls[1]?.[0].reports ?? [];
		expect(firstReports.length).toBeGreaterThan(0);
		expect(secondReports.length).toBeGreaterThan(0);
		for (const report of firstReports) expect(report.summary.failed).toBe(0);
		for (const report of secondReports) expect(report.summary.failed).toBe(1);
		expect(JSON.stringify(secondReports)).toContain("second test");

		// Each run minted its own runId.
		const runIds = events.filter((e) => e._tag === "RunStarted").map((e) => (e as { runId: string }).runId);
		expect(runIds).toHaveLength(2);
		expect(runIds[0]).not.toBe(runIds[1]);
	});

	it("still no-ops a repeated onTestRunEnd within one run", async () => {
		const { reporter, render, events } = makeReporter();
		await reporter.onInit({});

		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("once")], [], "passed");
		await reporter.onTestRunEnd([module("once")], [], "passed");
		expect(render).toHaveBeenCalledTimes(1);
		expect(runFinishedCount(events)).toBe(1);

		// And the guard re-arms for the next run after that duplicate.
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("again")], [], "passed");
		expect(render).toHaveBeenCalledTimes(2);
		expect(runFinishedCount(events)).toBe(2);
	});
});

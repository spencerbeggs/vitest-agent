/**
 * Colour-bearing pins for the Ink render path: every status glyph, the
 * count columns, the trend line, the coverage block, the failures block,
 * and a final `StreamApp` frame per run shape. The plain-frame suites pin
 * glyphs and layout with ANSI stripped; these pin which colour each glyph
 * and label is painted with, so a palette change is a reviewed diff.
 */

import type { FailureRecord, RunEvent } from "@vitest-agent/sdk";
import type { ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reduceRenderStateAll } from "../../src/reducer.js";
import type { StatusIconKind } from "../../src/render-ink/index.js";
import {
	CountColumns,
	CoverageBlock,
	FailuresSection,
	StatusIcon,
	StreamApp,
	TrendLine,
} from "../../src/render-ink/index.js";
import { ansiToTags, forceInkColor } from "../utils/ansi-tags.js";
import { renderInk } from "../utils/render-ink.js";

let restore: () => void = () => {};
beforeAll(async () => {
	restore = await forceInkColor();
});
afterAll(() => restore());

const paint = (tree: ReactElement, width = 100): string => {
	const r = renderInk(tree, width);
	const out = ansiToTags(r.rawFrame);
	r.cleanup();
	return out;
};

const NOW = Date.parse("2026-05-19T00:00:10.000Z");
const STARTED = "2026-05-19T00:00:00.000Z";

const STATUSES: ReadonlyArray<StatusIconKind> = [
	"passed",
	"failed",
	"skipped",
	"pending",
	"running",
	"queued",
	"finished",
	"threshold",
	"timed-out",
];

const failures: ReadonlyArray<FailureRecord> = [
	{
		modulePath: "src/math.test.ts",
		suitePath: ["math"],
		testName: "adds",
		classification: "new-failure",
		error: { message: "AssertionError: expected 3 to be 4\nat line 2", expected: "4", received: "3" },
	},
	{
		modulePath: "src/slow.test.ts",
		suitePath: [],
		testName: "waits",
		classification: null,
		timedOut: true,
		error: { message: "Test timed out in 5000ms." },
	},
];

describe("render-ink colour pins — primitives", () => {
	it("StatusIcon: every kind", async () => {
		const lines = STATUSES.map((s) => `${s.padEnd(10)} ${paint(<StatusIcon status={s} />)}`);
		await expect(lines.join("\n")).toMatchFileSnapshot("../snapshots/render-ink/color/status-icon.txt");
	});

	it("CountColumns: zeros and non-zeros", async () => {
		const out = [
			paint(<CountColumns passCount={12} failCount={2} skipCount={3} timeoutCount={1} />),
			paint(<CountColumns passCount={0} failCount={0} skipCount={0} timeoutCount={0} />),
		].join("\n");
		await expect(out).toMatchFileSnapshot("../snapshots/render-ink/color/count-columns.txt");
	});

	it("TrendLine: every direction", async () => {
		const out = (["improving", "regressing", "stable"] as const)
			.map((direction) => paint(<TrendLine trend={{ direction, runCount: direction === "stable" ? 1 : 6 }} />))
			.join("\n");
		await expect(out).toMatchFileSnapshot("../snapshots/render-ink/color/trend-line.txt");
	});

	it("CoverageBlock: a violation with fractional percents and elided gaps", async () => {
		const out = paint(
			<CoverageBlock
				coverage={{
					metrics: { lines: 72.46, branches: 60, functions: 85.25, statements: 83.33 },
					thresholds: { lines: 80, branches: 80, functions: 80 },
					violations: [
						{ metric: "lines", expected: 80, actual: 72.46 },
						{ metric: "branches", expected: 80, actual: 60 },
					],
					gaps: [
						{
							file: "src/a.ts",
							missing: { lines: 5, branches: 1, functions: 0, statements: 5 },
							uncoveredLines: "1-5",
						},
						{ file: "src/b.ts", missing: { lines: 9, branches: 2, functions: 1, statements: 9 } },
						{ file: "src/c.ts", missing: { lines: 1, branches: 0, functions: 0, statements: 1 } },
						{ file: "src/d.ts", missing: { lines: 3, branches: 0, functions: 0, statements: 3 } },
					],
				}}
			/>,
		);
		await expect(out).toMatchFileSnapshot("../snapshots/render-ink/color/coverage-block.txt");
	});

	it("FailuresSection: a classified failure and a timed-out failure, capped", async () => {
		const out = paint(<FailuresSection failures={[...failures, ...failures]} limit={3} />);
		await expect(out).toMatchFileSnapshot("../snapshots/render-ink/color/failures-section.txt");
	});
});

const workspaceEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
	{ _tag: "ModuleStarted", modulePath: "cli/a.test.ts", startedAt: STARTED, projectName: "cli" },
	{
		_tag: "TestFinished",
		modulePath: "cli/a.test.ts",
		testName: "rewrites the command",
		suitePath: ["injectEnv"],
		status: "failed",
		durationMs: 3,
		error: { message: "AssertionError: expected x to be y" },
	},
	{
		_tag: "FailureClassified",
		modulePath: "cli/a.test.ts",
		testName: "rewrites the command",
		classification: "persistent",
	},
	{
		_tag: "ModuleFinished",
		modulePath: "cli/a.test.ts",
		passCount: 54,
		failCount: 1,
		skipCount: 2,
		timeoutCount: 0,
		durationMs: 37_300,
		projectName: "cli",
	},
	{ _tag: "ModuleStarted", modulePath: "sdk/b.test.ts", startedAt: STARTED, projectName: "sdk" },
	{
		_tag: "TestFinished",
		modulePath: "sdk/b.test.ts",
		testName: "waits",
		suitePath: [],
		status: "failed",
		durationMs: 5000,
		timedOut: true,
		error: { message: "Test timed out in 5000ms." },
	},
	{
		_tag: "ModuleFinished",
		modulePath: "sdk/b.test.ts",
		passCount: 961,
		failCount: 0,
		skipCount: 0,
		timeoutCount: 1,
		durationMs: 250.4,
		projectName: "sdk",
	},
	{ _tag: "ModuleStarted", modulePath: "ui/c.test.ts", startedAt: STARTED, projectName: "ui" },
	{
		_tag: "ModuleFinished",
		modulePath: "ui/c.test.ts",
		passCount: 0,
		failCount: 0,
		skipCount: 4,
		timeoutCount: 0,
		durationMs: 1000,
		projectName: "ui",
	},
	{
		_tag: "CoverageReady",
		metrics: { lines: 72.5, branches: 90, functions: 90, statements: 90 },
		thresholds: { lines: 80 },
		gaps: [],
	},
	{ _tag: "ThresholdViolation", metric: "lines", expected: 80, actual: 72.5 },
	{ _tag: "TrendComputed", direction: "regressing", runCount: 5 },
	{
		_tag: "RunFinished",
		runId: "r",
		finishedAt: STARTED,
		passCount: 1015,
		failCount: 1,
		skipCount: 6,
		timeoutCount: 1,
		durationMs: 65_300,
	},
];

const singleProjectTimedOutEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
	{ _tag: "ModuleStarted", modulePath: "a.test.ts", startedAt: STARTED },
	{
		_tag: "ModuleFinished",
		modulePath: "a.test.ts",
		passCount: 3,
		failCount: 0,
		skipCount: 0,
		timeoutCount: 0,
		durationMs: 999.6,
	},
	{ _tag: "ModuleStarted", modulePath: "b.test.ts", startedAt: STARTED },
	{ _tag: "ModuleQueued", modulePath: "c.test.ts" },
	{ _tag: "TrendComputed", direction: "improving", runCount: 2 },
	{ _tag: "RunTimedOut", message: "process timeout" },
];

const singleFileEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
	{ _tag: "ModuleStarted", modulePath: "src/math.test.ts", startedAt: STARTED },
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "adds",
		suitePath: ["math"],
		status: "passed",
		durationMs: 12.34,
	},
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "subtracts",
		suitePath: ["math"],
		status: "failed",
		durationMs: 1.5,
		error: { message: "AssertionError: expected 1 to be 2", expected: "2", received: "1" },
	},
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "divides",
		suitePath: ["math"],
		status: "skipped",
		durationMs: 0,
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/math.test.ts",
		passCount: 1,
		failCount: 1,
		skipCount: 1,
		timeoutCount: 0,
		durationMs: 14.8,
	},
	{
		_tag: "CoverageReady",
		metrics: { lines: 95, branches: 95, functions: 95, statements: 95 },
		thresholds: { lines: 80 },
		gaps: [],
	},
	{ _tag: "TrendComputed", direction: "stable", runCount: 1 },
	{
		_tag: "RunFinished",
		runId: "r",
		finishedAt: STARTED,
		passCount: 1,
		failCount: 1,
		skipCount: 1,
		timeoutCount: 0,
		durationMs: 14.8,
	},
];

const singleTestEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
	{ _tag: "ModuleStarted", modulePath: "a.test.ts", startedAt: STARTED },
	{
		_tag: "TestFinished",
		modulePath: "a.test.ts",
		testName: "adds",
		suitePath: [],
		status: "failed",
		durationMs: 4.44,
		error: { message: "AssertionError: nope" },
	},
	{
		_tag: "ModuleFinished",
		modulePath: "a.test.ts",
		passCount: 0,
		failCount: 1,
		skipCount: 0,
		timeoutCount: 0,
		durationMs: 4.44,
	},
	{
		_tag: "RunFinished",
		runId: "r",
		finishedAt: STARTED,
		passCount: 0,
		failCount: 1,
		skipCount: 0,
		timeoutCount: 0,
		durationMs: 4.44,
	},
];

describe("render-ink colour pins — StreamApp final frame", () => {
	const frame = (events: ReadonlyArray<RunEvent>): string =>
		paint(<StreamApp state={reduceRenderStateAll(events)} frameIndex={0} nowMs={NOW} />);

	it("workspace: fail + timeout + skip-only + threshold violation + regressing trend", async () => {
		await expect(frame(workspaceEvents)).toMatchFileSnapshot("../snapshots/render-ink/color/stream-workspace.txt");
	});

	it("single-project: timed-out run with a running and a queued module", async () => {
		await expect(frame(singleProjectTimedOutEvents)).toMatchFileSnapshot(
			"../snapshots/render-ink/color/stream-single-project-timeout.txt",
		);
	});

	it("single-file: pass + inline fail + skip, clean coverage", async () => {
		await expect(frame(singleFileEvents)).toMatchFileSnapshot("../snapshots/render-ink/color/stream-single-file.txt");
	});

	it("single-test: failing leaf", async () => {
		await expect(frame(singleTestEvents)).toMatchFileSnapshot("../snapshots/render-ink/color/stream-single-test.txt");
	});
});

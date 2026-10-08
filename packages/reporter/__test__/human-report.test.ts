/**
 * The report-time human render (`renderHumanStringForReport`): the cell's
 * Ink half drawn through Ink's `renderToString`, laid out at the terminal's
 * width (issue #546) rather than a fixed 80 columns.
 */

import { CliEnv } from "@effected/cli";
import type { AgentReport } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { renderHumanString } from "../src/defaultReporter.js";

/** A test file path wider than 80 columns, so an 80-column layout must wrap it. */
const LONG_FILE = `src/${"nested-directory/".repeat(6)}a-module-with-a-long-name.test.ts`;

const report: AgentReport = {
	timestamp: "2026-05-14T00:00:00.000Z",
	project: "demo",
	reason: "failed",
	summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 10 },
	failed: [
		{
			file: LONG_FILE,
			state: "failed",
			duration: 7,
			tests: [
				{ name: "divides", fullName: "math > divides", state: "failed", duration: 7, errors: [{ message: "boom" }] },
			],
		},
	],
	unhandledErrors: [],
	failedFiles: [LONG_FILE],
};

const widestLine = (text: string): number => Math.max(...text.split("\n").map((line) => line.trimEnd().length));

describe("renderHumanStringForReport width (#546)", () => {
	it("lays out at the terminal's width when one is known", async () => {
		const out = await renderHumanString(report, {}, CliEnv.layerTest({ tty: true, columns: 160 }));
		expect(out).toContain(LONG_FILE);
		expect(widestLine(out)).toBeGreaterThan(80);
	});

	it("falls back to 80 columns when no terminal width is known (not a TTY)", async () => {
		const out = await renderHumanString(report, {}, CliEnv.layerTest());
		expect(out).not.toContain(LONG_FILE);
		expect(widestLine(out)).toBeLessThanOrEqual(80);
	});

	it("an explicit width beats the terminal's", async () => {
		const out = await renderHumanString(report, { width: 60 }, CliEnv.layerTest({ tty: true, columns: 160 }));
		expect(widestLine(out)).toBeLessThanOrEqual(60);
	});
});

describe("renderHumanStringForReport stray output", () => {
	it("prints the stray-output note under the cell", async () => {
		const out = await renderHumanString(
			{
				...report,
				strayOutput: {
					total: 1,
					stdout: 0,
					stderr: 1,
					bytes: 40,
					samples: [{ stream: "stderr", text: "Preparing worktree (new branch 'x')" }],
				},
			},
			{ width: 200 },
			CliEnv.layerTest(),
		);
		expect(out).toContain("Stray output: tests wrote 1 line directly to stderr");
		expect(out).toContain("stderr: Preparing worktree (new branch 'x')");
	});
});

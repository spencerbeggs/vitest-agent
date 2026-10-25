/**
 * The report-time human render (`renderHumanStringForReport`): the cell's
 * Ink half drawn through Ink's `renderToString`, laid out at the terminal's
 * width (issue #546) rather than a fixed 80 columns.
 */

import { CliEnv, CliLinks } from "@effected/cli";
import { Audience, TerminalEnv } from "@effected/env";
import type { AgentReport } from "@vitest-agent/sdk";
import { Layer } from "effect";
import { describe, expect, it } from "vitest";
import { renderAgentStringForReport, renderHumanString } from "../src/defaultReporter.js";

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

/**
 * File links (issue #541): the kit decides them. `CliLinks` picks where a
 * file opens, `TerminalEnv.stdout.hyperlinks` whether stdout renders OSC 8,
 * and an agent audience never gets an escape. `CliLinks.layerTest` links
 * absolute paths only, so the report here names one.
 */
describe("renderHumanStringForReport file links (#541)", () => {
	const OSC8 = "\u001b]8;;";
	const ABSOLUTE_FILE = "/repo/src/math.test.ts";
	const absoluteReport: AgentReport = {
		...report,
		failed: [{ ...(report.failed[0] as AgentReport["failed"][number]), file: ABSOLUTE_FILE }],
		failedFiles: [ABSOLUTE_FILE],
	};
	/** A human at a VS Code terminal that renders hyperlinks. */
	const linkingEnv = Layer.mergeAll(
		CliEnv.layerTest({ tty: true, columns: 200 }),
		TerminalEnv.layerTest({ stdout: { isTerminal: true, hyperlinks: true } }),
		CliLinks.layerTest("vscode"),
	);

	it("a human at a terminal with hyperlink support gets the test file as an editor link", async () => {
		const out = await renderHumanString(absoluteReport, {}, linkingEnv);
		expect(out).toContain(`${OSC8}vscode://file/repo/src/math.test.ts\u001b\\${ABSOLUTE_FILE}\u001b]8;;\u001b\\`);
	});

	it("an agent audience gets the path alone, whatever the terminal can do", async () => {
		const out = await renderHumanString(absoluteReport, {}, Layer.mergeAll(linkingEnv, Audience.layerTest("agent")));
		expect(out).toContain(ABSOLUTE_FILE);
		expect(out).not.toContain(OSC8);
	});

	it("a terminal that cannot render hyperlinks gets the path alone", async () => {
		const out = await renderHumanString(
			absoluteReport,
			{},
			Layer.mergeAll(CliEnv.layerTest({ tty: true, columns: 200 }), CliLinks.layerTest("vscode")),
		);
		expect(out).toContain(ABSOLUTE_FILE);
		expect(out).not.toContain(OSC8);
	});

	it("an environment without CliLinks renders, with the path alone", async () => {
		const out = await renderHumanString(absoluteReport, {}, CliEnv.layerTest({ tty: true, columns: 200 }));
		expect(out).toContain(ABSOLUTE_FILE);
		expect(out).not.toContain(OSC8);
	});

	it("the agent string never carries a link", () => {
		const out = renderAgentStringForReport(absoluteReport);
		expect(out).toContain(ABSOLUTE_FILE);
		expect(out).not.toContain("\u001b");
	});
});

import type { AgentReport, ConsoleLeaks } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { formatReportMarkdown } from "../src/tools/run-tests.js";

const baseReport: AgentReport = {
	timestamp: "2026-06-26T00:00:00.000Z",
	reason: "passed",
	summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 5 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
};

describe("formatReportMarkdown console-leak line", () => {
	it("emits a plural warning line for multiple writes/files", () => {
		const consoleLeaks: ConsoleLeaks = {
			total: 7,
			byFile: [
				{ file: "a.test.ts", stdout: 5, stderr: 0 },
				{ file: "b.test.ts", stdout: 2, stderr: 0 },
			],
		};
		const md = formatReportMarkdown({ ...baseReport, consoleLeaks });
		expect(md).toContain("⚠");
		expect(md).toContain("7 stray console writes across 2 files");
		expect(md).toContain("consoleLeaks");
	});

	it("renders the file count as a floor (N+) when byFile was truncated", () => {
		const consoleLeaks: ConsoleLeaks = {
			total: 60,
			byFile: Array.from({ length: 25 }, (_, i) => ({ file: `f${i}.test.ts`, stdout: 1, stderr: 0 })),
			truncated: true,
		};
		const md = formatReportMarkdown({ ...baseReport, consoleLeaks });
		expect(md).toContain("60 stray console writes across 25+ files");
	});

	it("uses singular for exactly one write in one file", () => {
		const consoleLeaks: ConsoleLeaks = { total: 1, byFile: [{ file: "a.test.ts", stdout: 1, stderr: 0 }] };
		const md = formatReportMarkdown({ ...baseReport, consoleLeaks });
		expect(md).toContain("1 stray console write across 1 file");
	});

	it("emits nothing when consoleLeaks is absent", () => {
		expect(formatReportMarkdown(baseReport)).not.toContain("stray console");
	});
});

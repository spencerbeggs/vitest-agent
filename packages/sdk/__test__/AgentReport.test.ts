import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AgentReport, ModuleReport, ReportSummary, TestReport } from "../src/schemas/AgentReport.js";

describe("ReportSummary", () => {
	it("accepts valid summary", () => {
		const input = { total: 10, passed: 8, failed: 2, skipped: 0, duration: 340 };
		const result = Schema.decodeUnknownSync(ReportSummary)(input);
		expect(result).toEqual(input);
	});

	it("rejects missing fields", () => {
		expect(() => Schema.decodeUnknownSync(ReportSummary)({ total: 10, passed: 8 })).toThrow();
	});
});

describe("TestReport", () => {
	it("accepts a minimal test report", () => {
		const input = { name: "handles empty", fullName: "compress > handles empty", state: "passed" };
		const result = Schema.decodeUnknownSync(TestReport)(input);
		expect(result).toEqual(input);
	});

	it("accepts a full test report with all optional fields", () => {
		const input = {
			name: "handles empty",
			fullName: "compress > handles empty",
			state: "failed",
			duration: 12,
			flaky: true,
			slow: false,
			errors: [{ message: "Expected 1 to be 2", diff: "- 1\n+ 2" }],
			classification: "new-failure",
		};
		const result = Schema.decodeUnknownSync(TestReport)(input);
		expect(result).toEqual(input);
	});

	it("rejects invalid state", () => {
		expect(() =>
			Schema.decodeUnknownSync(TestReport)({
				name: "test",
				fullName: "test",
				state: "unknown",
			}),
		).toThrow();
	});

	it("rejects invalid classification", () => {
		expect(() =>
			Schema.decodeUnknownSync(TestReport)({
				name: "test",
				fullName: "test",
				state: "passed",
				classification: "bad",
			}),
		).toThrow();
	});
});

describe("ModuleReport", () => {
	it("accepts a valid module report", () => {
		const input = {
			file: "src/utils.test.ts",
			state: "failed",
			duration: 50,
			tests: [
				{
					name: "handles empty",
					fullName: "compress > handles empty",
					state: "failed",
					errors: [{ message: "assertion failed" }],
				},
			],
		};
		const result = Schema.decodeUnknownSync(ModuleReport)(input);
		expect(result).toEqual(input);
	});

	it("accepts module with empty tests array", () => {
		const input = { file: "src/empty.test.ts", state: "passed", tests: [] };
		const result = Schema.decodeUnknownSync(ModuleReport)(input);
		expect(result.tests).toEqual([]);
	});

	it("accepts module-level errors", () => {
		const input = {
			file: "src/broken.test.ts",
			state: "failed",
			errors: [{ message: "SyntaxError: Unexpected token", stack: "at line 1" }],
			tests: [],
		};
		const result = Schema.decodeUnknownSync(ModuleReport)(input);
		expect(result.errors).toHaveLength(1);
	});

	it("rejects missing tests field", () => {
		expect(() =>
			Schema.decodeUnknownSync(ModuleReport)({
				file: "src/test.ts",
				state: "passed",
			}),
		).toThrow();
	});
});

describe("AgentReport", () => {
	const sampleReport = {
		timestamp: "2026-03-20T00:00:00.000Z",
		reason: "passed",
		summary: { total: 5, passed: 5, failed: 0, skipped: 0, duration: 120 },
		failed: [],
		unhandledErrors: [],
		failedFiles: [],
	};

	it("accepts a valid minimal report", () => {
		const result = Schema.decodeUnknownSync(AgentReport)(sampleReport);
		expect(result).toEqual(sampleReport);
	});

	it("accepts a report with project name", () => {
		const input = { ...sampleReport, project: "core:unit" };
		const result = Schema.decodeUnknownSync(AgentReport)(input);
		expect(result.project).toBe("core:unit");
	});

	it("accepts a report with coverage", () => {
		const input = {
			...sampleReport,
			coverage: {
				totals: { statements: 90, branches: 85, functions: 88, lines: 91 },
				thresholds: { global: { lines: 80 } },
				lowCoverage: [],
				lowCoverageFiles: [],
			},
		};
		const result = Schema.decodeUnknownSync(AgentReport)(input);
		expect(result.coverage).toBeDefined();
		expect(result.coverage?.scoped).toBe(false);
	});

	it("accepts a report with failed modules", () => {
		const input = {
			...sampleReport,
			reason: "failed",
			summary: { total: 5, passed: 3, failed: 2, skipped: 0, duration: 340 },
			failed: [
				{
					file: "src/utils.test.ts",
					state: "failed",
					tests: [
						{
							name: "handles empty",
							fullName: "compress > handles empty",
							state: "failed",
							errors: [{ message: "Expected [] to equal ['']" }],
						},
					],
				},
			],
			failedFiles: ["src/utils.test.ts"],
		};
		const result = Schema.decodeUnknownSync(AgentReport)(input);
		expect(result.failed).toHaveLength(1);
		expect(result.failedFiles).toEqual(["src/utils.test.ts"]);
	});

	it("accepts a report with unhandled errors", () => {
		const input = {
			...sampleReport,
			reason: "failed",
			unhandledErrors: [{ message: "Unhandled rejection", stack: "at process..." }],
		};
		const result = Schema.decodeUnknownSync(AgentReport)(input);
		expect(result.unhandledErrors).toHaveLength(1);
	});

	it("rejects invalid reason", () => {
		expect(() => Schema.decodeUnknownSync(AgentReport)({ ...sampleReport, reason: "unknown" })).toThrow();
	});

	it("rejects missing required fields", () => {
		expect(() =>
			Schema.decodeUnknownSync(AgentReport)({
				timestamp: "2026-03-20T00:00:00.000Z",
				reason: "passed",
			}),
		).toThrow();
	});
});

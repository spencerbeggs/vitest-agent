import { describe, expect, it } from "vitest";
import { ciAnnotationsFormatter } from "../src/formatters/ci-annotations.js";
import type { AgentReport } from "../src/schemas/AgentReport.js";

describe("ciAnnotationsFormatter", () => {
	it("emits one ::error::... line per failed test with extracted file/line", () => {
		const report: AgentReport = {
			timestamp: "2026-04-29T00:00:00Z",
			project: "demo",
			reason: "failed",
			summary: { total: 2, passed: 1, failed: 1, skipped: 0, duration: 50 },
			failed: [
				{
					file: "src/foo.test.ts",
					state: "failed",
					tests: [
						{
							name: "fails",
							fullName: "Foo > fails",
							state: "failed",
							errors: [
								{
									message: "expected 1 to equal 2",
									stack: "Error: expected 1 to equal 2\n    at Object.<anonymous> (src/foo.test.ts:42:7)",
								},
							],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/foo.test.ts"],
		};
		const out = ciAnnotationsFormatter.render([report], {
			detail: "neutral",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(out).toHaveLength(1);
		expect(out[0].target).toBe("stdout");
		expect(out[0].content).toContain("::error file=src/foo.test.ts,line=42");
		expect(out[0].content).toContain("expected 1 to equal 2");
	});

	it("emits a single passing-summary ::notice when no failures", () => {
		const report: AgentReport = {
			timestamp: "2026-04-29T00:00:00Z",
			reason: "passed",
			summary: { total: 5, passed: 5, failed: 0, skipped: 0, duration: 30 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
		};
		const out = ciAnnotationsFormatter.render([report], {
			detail: "neutral",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(out[0].content).toContain("::notice");
		expect(out[0].content).toContain("5 passed");
	});

	it("escapes carriage returns and percent signs per GitHub Actions spec", () => {
		const report: AgentReport = {
			timestamp: "2026-04-29T00:00:00Z",
			reason: "failed",
			summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 10 },
			failed: [
				{
					file: "src/x.test.ts",
					state: "failed",
					tests: [
						{
							name: "fails",
							fullName: "X > fails",
							state: "failed",
							errors: [{ message: "100%\nbroken\rfoo" }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/x.test.ts"],
		};
		const out = ciAnnotationsFormatter.render([report], {
			detail: "neutral",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(out[0].content).toContain("100%25");
		expect(out[0].content).toContain("%0A");
		expect(out[0].content).toContain("%0D");
	});

	it("emits a fallback ::error for a failed test with no attached errors", () => {
		const report: AgentReport = {
			timestamp: "2026-04-29T00:00:00Z",
			project: "demo",
			reason: "failed",
			summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 5 },
			failed: [
				{
					file: "src/empty.test.ts",
					state: "failed",
					tests: [
						{
							name: "fails silently",
							fullName: "Empty > fails silently",
							state: "failed",
							errors: [],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/empty.test.ts"],
		};
		const out = ciAnnotationsFormatter.render([report], {
			detail: "neutral",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(out).toHaveLength(1);
		expect(out[0].target).toBe("stdout");
		expect(out[0].content).toContain("::error file=src/empty.test.ts,line=1");
		expect(out[0].content).toContain("title=Empty > fails silently");
		expect(out[0].content).toContain("Empty > fails silently failed");
	});

	it("also emits a fallback ::error when a failed test has undefined errors", () => {
		const report: AgentReport = {
			timestamp: "2026-04-29T00:00:00Z",
			project: "demo",
			reason: "failed",
			summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 5 },
			failed: [
				{
					file: "src/missing.test.ts",
					state: "failed",
					tests: [
						{
							name: "no errors field",
							fullName: "Missing > no errors field",
							state: "failed",
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/missing.test.ts"],
		};
		const out = ciAnnotationsFormatter.render([report], {
			detail: "neutral",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(out[0].content).toContain("::error file=src/missing.test.ts,line=1");
		expect(out[0].content).toContain("Missing > no errors field failed");
	});

	it("emits an Unhandled error ::error annotation for each unhandled error", () => {
		const report: AgentReport = {
			timestamp: "2026-04-29T00:00:00Z",
			project: "demo",
			reason: "failed",
			summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 12 },
			failed: [],
			unhandledErrors: [{ message: "boom: top-level rejection" }, { message: "second unhandled" }],
			failedFiles: [],
		};
		const out = ciAnnotationsFormatter.render([report], {
			detail: "neutral",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(out).toHaveLength(1);
		expect(out[0].content).toContain("::error title=Unhandled%20error::boom: top-level rejection");
		expect(out[0].content).toContain("::error title=Unhandled%20error::second unhandled");
		// And the passing-summary ::notice MUST NOT be emitted because allLines is non-empty.
		expect(out[0].content).not.toContain("::notice");
	});

	it("matches pathological '(((!((!' stack input in linear time (ReDoS regression)", () => {
		// CodeQL flagged the original STACK_FILE_LINE regex as polynomial on
		// inputs with many `(` and no closing `)`. Both `:` and `(` are now
		// excluded from the file-path character class so the engine cannot
		// retry at every `(` position. A 50k-char pathological input must
		// complete well under the test budget.
		const pathological = `Error\n    at fn ${"(".repeat(50000)}!`;
		const report: AgentReport = {
			timestamp: "2026-04-29T00:00:00Z",
			reason: "failed",
			summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 1 },
			failed: [
				{
					file: "src/x.test.ts",
					state: "failed",
					tests: [
						{
							name: "fails",
							fullName: "X > fails",
							state: "failed",
							errors: [{ message: "boom", stack: pathological }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/x.test.ts"],
		};
		const start = Date.now();
		const out = ciAnnotationsFormatter.render([report], {
			detail: "neutral",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		const elapsed = Date.now() - start;
		expect(out).toHaveLength(1);
		expect(elapsed).toBeLessThan(500);
	});
});

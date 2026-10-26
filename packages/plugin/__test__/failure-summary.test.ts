import type { AgentReport } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { formatFailureSummary, shouldWriteFailureSummary } from "../src/utils/failure-summary.js";

const mod = (file: string, tests: Array<{ name: string; msg?: string }>, errors: string[] = []) => ({
	file,
	state: "failed" as const,
	...(errors.length > 0 && { errors: errors.map((message) => ({ message })) }),
	tests: tests.map((t) => ({
		name: t.name,
		fullName: t.name,
		state: "failed" as const,
		...(t.msg !== undefined && { errors: [{ message: t.msg }] }),
	})),
});

const report = (failed: AgentReport["failed"], unhandled: string[] = [], reason = "failed"): AgentReport =>
	({
		reason,
		failed,
		unhandledErrors: unhandled.map((message) => ({ message })),
		failedFiles: failed.map((f) => f.file),
	}) as unknown as AgentReport;

describe("formatFailureSummary", () => {
	it("returns undefined for a passing run", () => {
		expect(formatFailureSummary([report([], [], "passed")], "passed")).toBeUndefined();
	});

	it("summarizes one failed test with its first message line", () => {
		const out = formatFailureSummary([report([mod("a.test.ts", [{ name: "t1", msg: "boom\nsecond" }])])], "failed");
		expect(out).toBe("vitest-agent: 1 failed test in 1 file\n  FAIL a.test.ts > t1\n    boom");
	});

	it("includes a module-only error with zero failed tests", () => {
		const out = formatFailureSummary([report([mod("b.test.ts", [], ["import failed"])])], "failed");
		expect(out).toContain("FAIL b.test.ts\n    import failed");
	});

	it("counts unhandled errors once across reports", () => {
		const out = formatFailureSummary(
			[report([mod("a.test.ts", [{ name: "t", msg: "x" }])], ["oops"]), report([], ["oops"])],
			"failed",
		);
		expect(out).toContain("1 failed test in 1 file, 1 unhandled error");
		expect(out).toContain("  ERROR oops");
	});

	it("reports an interrupted run with no failures", () => {
		expect(formatFailureSummary([report([], [], "interrupted")], "interrupted")).toMatch(
			/^vitest-agent: run interrupted/,
		);
	});

	it("caps at 15 lines and spends the last on '... N more'", () => {
		const tests = Array.from({ length: 20 }, (_, i) => ({ name: `t${i}` }));
		const out = formatFailureSummary([report([mod("a.test.ts", tests)])], "failed") ?? "";
		const lines = out.split("\n");
		expect(lines.length).toBeLessThanOrEqual(15);
		expect(lines.at(-1)).toMatch(/^ {2}\.\.\. \d+ more$/);
		expect(lines).toHaveLength(15);
	});

	it("strips ANSI codes from messages", () => {
		const out = formatFailureSummary(
			[report([mod("a.test.ts", [{ name: "t", msg: "\u001b[31mred\u001b[39m" }])])],
			"failed",
		);
		expect(out).toContain("    red");
		expect(out).not.toContain("\u001b");
	});
});

describe("shouldWriteFailureSummary", () => {
	it("is true only where the plugin owns stdout", () => {
		expect(["agent", "stream", "ci-annotations"].every((m) => shouldWriteFailureSummary(m as never))).toBe(true);
		expect(shouldWriteFailureSummary("passthrough")).toBe(false);
		expect(shouldWriteFailureSummary("silent")).toBe(false);
	});
});

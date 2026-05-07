import { describe, expect, it } from "vitest";
import type { HistoryRecord } from "vitest-agent-sdk";
import { formatHistory } from "../src/lib/format-history.js";

function makeRecord(project: string, tests: HistoryRecord["tests"]): HistoryRecord {
	return {
		project,
		updatedAt: "2026-03-21T00:00:00.000Z",
		tests,
	};
}

function makeTest(fullName: string, states: Array<"passed" | "failed">): HistoryRecord["tests"][number] {
	// runs are stored most-recent-first
	return {
		fullName,
		runs: states.map((state, i) => ({
			state,
			timestamp: `2026-03-${String(21 - i).padStart(2, "0")}T00:00:00.000Z`,
		})),
	};
}

describe("formatHistory", () => {
	it("returns no-history message when records array is empty", () => {
		const result = formatHistory([]);
		expect(result).toContain("## Test Failure History");
		expect(result).toContain("No failure history to display");
	});

	it("returns no-history message when all tests are stable", () => {
		const record = makeRecord("default", [makeTest("a > b", ["passed", "passed", "passed"])]);
		const result = formatHistory([record]);
		expect(result).toContain("No failure history to display");
	});

	it("shows flaky tests with P/F visualization", () => {
		// runs stored most-recent-first: [failed, passed, failed, passed]
		// visualization oldest-left = reversed: PFPF -> but we reverse = [passed, failed, passed, failed] -> PFPF
		const record = makeRecord("default", [makeTest("suite > flaky test", ["failed", "passed", "failed", "passed"])]);
		const result = formatHistory([record]);
		expect(result).toContain("Flaky tests");
		expect(result).toContain("suite > flaky test");
	});

	it("shows P/F visualization oldest-left (reverse of stored order)", () => {
		// stored most-recent-first: [failed, passed, failed] => oldest-left visualization: FPF
		// This is flaky: current=failed, prior=[passed, failed], not allPriorPassed, prior[0]=passed => flaky
		const record = makeRecord("default", [makeTest("my > test", ["failed", "passed", "failed"])]);
		const result = formatHistory([record]);
		expect(result).toContain("FPF");
	});

	it("shows persistent failures for consecutive failures", () => {
		// stored most-recent-first: [failed, failed, passed]
		const record = makeRecord("default", [makeTest("suite > persistent", ["failed", "failed", "passed"])]);
		const result = formatHistory([record]);
		expect(result).toContain("Persistent failures");
		expect(result).toContain("suite > persistent");
	});

	it("shows recently recovered tests", () => {
		// stored most-recent-first: [passed, failed, failed]
		const record = makeRecord("default", [makeTest("suite > recovered", ["passed", "failed", "failed"])]);
		const result = formatHistory([record]);
		expect(result).toContain("Recently recovered");
		expect(result).toContain("suite > recovered");
	});

	it("groups flaky before persistent before recovered", () => {
		const record = makeRecord("default", [
			makeTest("suite > flaky", ["failed", "passed", "failed", "passed"]),
			makeTest("suite > persistent", ["failed", "failed", "passed"]),
			makeTest("suite > recovered", ["passed", "failed", "failed"]),
		]);
		const result = formatHistory([record]);
		const flakyIdx = result.indexOf("Flaky tests");
		const persistentIdx = result.indexOf("Persistent failures");
		const recoveredIdx = result.indexOf("Recently recovered");
		expect(flakyIdx).toBeLessThan(persistentIdx);
		expect(persistentIdx).toBeLessThan(recoveredIdx);
	});

	it("skips stable tests", () => {
		const record = makeRecord("default", [
			makeTest("suite > stable", ["passed", "passed"]),
			makeTest("suite > flaky", ["failed", "passed", "failed", "passed"]),
		]);
		const result = formatHistory([record]);
		expect(result).not.toContain("suite > stable");
		expect(result).toContain("suite > flaky");
	});

	it("skips new-failure tests (only one run or all prior passed)", () => {
		// new-failure: current failed, no prior failures
		const record = makeRecord("default", [makeTest("suite > new", ["failed", "passed"])]);
		const result = formatHistory([record]);
		expect(result).toContain("No failure history to display");
	});

	it("shows per-project sections for multiple projects", () => {
		const records = [
			makeRecord("project-a", [makeTest("a > flaky", ["failed", "passed", "failed", "passed"])]),
			makeRecord("project-b", [makeTest("b > persistent", ["failed", "failed", "passed"])]),
		];
		const result = formatHistory(records);
		expect(result).toContain("Project: project-a");
		expect(result).toContain("Project: project-b");
	});

	it("omits project header for single default project", () => {
		const record = makeRecord("default", [makeTest("suite > flaky", ["failed", "passed", "failed", "passed"])]);
		const result = formatHistory([record]);
		expect(result).not.toContain("Project: default");
	});

	it("shows fail rate percentage for flaky tests", () => {
		// 2 failed out of 4 = 50%
		const record = makeRecord("default", [makeTest("suite > flaky", ["failed", "passed", "failed", "passed"])]);
		const result = formatHistory([record]);
		expect(result).toContain("2/4 (50%)");
	});

	it("shows consecutive failure count for persistent tests", () => {
		// 2 consecutive failures
		const record = makeRecord("default", [makeTest("suite > persistent", ["failed", "failed", "passed"])]);
		const result = formatHistory([record]);
		expect(result).toContain("2 runs");
	});
});

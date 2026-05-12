import { describe, expect, it } from "vitest";
import type { AgentReport } from "vitest-agent-sdk";
import { formatShow } from "../src/lib/format-show.js";

const reportFixture: AgentReport = {
	timestamp: "2026-05-12T00:00:00.000Z",
	reason: "failed",
	summary: { total: 4, passed: 2, failed: 1, skipped: 1, duration: 100 },
	failed: [
		{
			file: "src/math.test.ts",
			state: "failed",
			duration: 14,
			tests: [
				{
					name: "divides",
					fullName: "math > divides",
					state: "failed",
					duration: 7,
					errors: [{ message: "expected 0.5 to equal 0.5000001", diff: "- 0.5000001\n+ 0.5" }],
					classification: "new-failure",
				},
			],
		},
	],
	unhandledErrors: [],
	failedFiles: ["src/math.test.ts"],
};

const stripAnsi = (input: string): string =>
	input.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

describe("formatShow", () => {
	it("agent format produces the markdown-flavored final frame", () => {
		const output = formatShow(reportFixture, "agent");
		expect(output).toContain("Tests: 2/4 passed, 1 failed, 1 skipped (100ms)");
		expect(output).toContain("Failures:");
		expect(output).toContain("[new-failure]");
		expect(output).toContain("expected 0.5 to equal 0.5000001");
	});

	it("human format produces an Ink-rendered frame with the same content", () => {
		const output = stripAnsi(formatShow(reportFixture, "human"));
		expect(output).toContain("Tests: 2/4 passed, 1 failed, 1 skipped (100ms)");
		expect(output).toContain("Failures");
		expect(output).toContain("src/math.test.ts");
		expect(output).toContain("divides");
	});

	it("json format produces a stable JSON dump", () => {
		const output = formatShow(reportFixture, "json");
		expect(() => JSON.parse(output)).not.toThrow();
		const parsed = JSON.parse(output);
		expect(parsed.summary.failed).toBe(1);
	});

	it("accepts a width option in human format", () => {
		const out = stripAnsi(formatShow(reportFixture, "human", { width: 50 }));
		expect(out).toContain("Failures");
	});

	it("is deterministic across repeat calls", () => {
		const a = formatShow(reportFixture, "agent");
		const b = formatShow(reportFixture, "agent");
		expect(a).toBe(b);

		const c = formatShow(reportFixture, "human");
		const d = formatShow(reportFixture, "human");
		expect(c).toBe(d);
	});
});

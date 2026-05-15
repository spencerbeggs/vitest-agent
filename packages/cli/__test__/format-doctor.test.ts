import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/lib/format-doctor.js";
import { formatDoctor } from "../src/lib/format-doctor.js";

describe("formatDoctor", () => {
	it("renders all-passing checks without suggestion", () => {
		const results: CheckResult[] = [
			{ name: "Cache found", passed: true, detail: "`/some/path`" },
			{ name: "Manifest valid", passed: true, detail: "2 projects" },
		];
		const output = formatDoctor(results);
		expect(output).toContain("- [x] Cache found: `/some/path`");
		expect(output).toContain("- [x] Manifest valid: 2 projects");
		expect(output).not.toContain("Suggestion");
	});

	it("renders failed checks with suggestion", () => {
		const results: CheckResult[] = [
			{ name: "Cache found", passed: true, detail: "`/some/path`" },
			{
				name: "History",
				passed: false,
				detail: "1/2 valid -- `history/default.history.json` corrupt",
			},
		];
		const output = formatDoctor(results);
		expect(output).toContain("- [ ] History:");
		expect(output).toContain("Suggestion: Run `vitest-agent db reset`");
	});

	it("renders empty results", () => {
		const output = formatDoctor([]);
		expect(output).toContain("## Doctor");
		expect(output).not.toContain("Suggestion");
	});
});

import { describe, expect, it } from "vitest";
import { ensureGithubActionsReporter } from "../src/utils/ensure-github-reporter.js";

describe("ensureGithubActionsReporter", () => {
	it('appends ["github-actions", {}] when absent', () => {
		const result = ensureGithubActionsReporter(["default", "json"]);
		expect(result).toEqual(["default", "json", ["github-actions", {}]]);
	});

	it("does not double-inject when a bare string entry is already present", () => {
		const result = ensureGithubActionsReporter(["default", "github-actions"]);
		expect(result).toEqual(["default", "github-actions"]);
	});

	it("does not double-inject when a tuple entry is already present", () => {
		const result = ensureGithubActionsReporter(["default", ["github-actions", { foo: "bar" }]]);
		expect(result).toEqual(["default", ["github-actions", { foo: "bar" }]]);
	});

	it("does not mutate the input array and preserves unknown entry forms", () => {
		class CustomReporter {}
		const custom = new CustomReporter();
		const input = ["default", custom, "./custom-reporter.js"];
		const result = ensureGithubActionsReporter(input);
		expect(input).toEqual(["default", custom, "./custom-reporter.js"]);
		expect(result).toEqual(["default", custom, "./custom-reporter.js", ["github-actions", {}]]);
		expect(result).not.toBe(input);
	});
});

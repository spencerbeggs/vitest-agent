import { describe, expect, it } from "vitest";
import { ensureGithubActionsReporter } from "../src/utils/ensure-github-reporter.js";

describe("ensureGithubActionsReporter", () => {
	it("appends github-actions with the job summary disabled when absent", () => {
		const result = ensureGithubActionsReporter(["default", "json"]);
		expect(result).toEqual(["default", "json", ["github-actions", { jobSummary: { enabled: false } }]]);
	});

	it("does not re-enable the job summary on an entry the user already configured", () => {
		const result = ensureGithubActionsReporter(["default", ["github-actions", { jobSummary: { enabled: true } }]]);
		expect(result).toEqual(["default", ["github-actions", { jobSummary: { enabled: true } }]]);
	});

	it("normalizes a bare string entry into a tuple with the job summary disabled", () => {
		const result = ensureGithubActionsReporter(["default", "github-actions"]);
		expect(result).toEqual(["default", ["github-actions", { jobSummary: { enabled: false } }]]);
	});

	it("normalizes a tuple whose options omit jobSummary", () => {
		const result = ensureGithubActionsReporter(["default", ["github-actions", {}]]);
		expect(result).toEqual(["default", ["github-actions", { jobSummary: { enabled: false } }]]);
	});

	it("preserves other reporter options while disabling the job summary", () => {
		const result = ensureGithubActionsReporter(["default", ["github-actions", { onWritePath: "/tmp/x" }]]);
		expect(result).toEqual(["default", ["github-actions", { onWritePath: "/tmp/x", jobSummary: { enabled: false } }]]);
	});

	it("preserves other jobSummary keys while disabling it", () => {
		const result = ensureGithubActionsReporter([["github-actions", { jobSummary: { onWritePath: "/tmp/s" } }]]);
		expect(result).toEqual([["github-actions", { jobSummary: { onWritePath: "/tmp/s", enabled: false } }]]);
	});

	it("preserves array order when normalizing an existing entry", () => {
		const result = ensureGithubActionsReporter(["github-actions", "default", "json"]);
		expect(result).toEqual([["github-actions", { jobSummary: { enabled: false } }], "default", "json"]);
	});

	it("does not append a second entry when one is already present", () => {
		const result = ensureGithubActionsReporter(["default", "github-actions"]);
		expect(result.filter((e) => Array.isArray(e) && e[0] === "github-actions")).toHaveLength(1);
	});

	it("does not mutate the input array and preserves unknown entry forms", () => {
		class CustomReporter {}
		const custom = new CustomReporter();
		const input = ["default", custom, "./custom-reporter.js"];
		const result = ensureGithubActionsReporter(input);
		expect(input).toEqual(["default", custom, "./custom-reporter.js"]);
		expect(result).toEqual([
			"default",
			custom,
			"./custom-reporter.js",
			["github-actions", { jobSummary: { enabled: false } }],
		]);
		expect(result).not.toBe(input);
	});

	it("does not mutate an existing tuple entry's options object", () => {
		const options: { jobSummary: Record<string, unknown> } = { jobSummary: {} };
		const entry = ["github-actions", options];
		const input = ["default", entry];
		const result = ensureGithubActionsReporter(input);
		expect(options).toEqual({ jobSummary: {} });
		expect(entry).toEqual(["github-actions", { jobSummary: {} }]);
		expect(result).toEqual(["default", ["github-actions", { jobSummary: { enabled: false } }]]);
	});
});

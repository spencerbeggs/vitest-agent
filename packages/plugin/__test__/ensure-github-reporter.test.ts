import { describe, expect, it } from "vitest";
import { ensureGithubActionsReporter } from "../src/utils/ensure-github-reporter.js";

describe("ensureGithubActionsReporter", () => {
	it('appends ["github-actions", {}] when absent', () => {
		const result = ensureGithubActionsReporter(["default", "json"]);
		expect(result).toEqual(["default", "json", ["github-actions", {}]]);
	});
});

import { describe, expect, it } from "vitest";
import { regressionSincePassPrompt } from "../src/prompts/regression-since-pass.js";

describe("regressionSincePassPrompt", () => {
	it("interpolates the test name", () => {
		const text = regressionSincePassPrompt({ test: "MyTest" }).messages[0].content.text;
		expect(text).toContain("MyTest");
	});

	it("references test_history, commit_changes, and turn_search", () => {
		const text = regressionSincePassPrompt({ test: "x" }).messages[0].content.text;
		expect(text).toContain("test_history");
		expect(text).toContain("commit_changes");
		expect(text).toContain("turn_search");
	});

	it("ends with a hypothesis_record reminder", () => {
		const text = regressionSincePassPrompt({ test: "x" }).messages[0].content.text;
		expect(text).toContain("hypothesis_record");
	});
});

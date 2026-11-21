import { describe, expect, it } from "vitest";
import { whyFlakyPrompt } from "../src/prompts/why-flaky.js";

describe("whyFlakyPrompt", () => {
	it("interpolates the test name into the body", () => {
		const text = whyFlakyPrompt({ test: "Suite > nested > test" }).messages[0].content.text;
		expect(text).toContain("Suite > nested > test");
	});

	it("references test_history and failure_signature_get", () => {
		const text = whyFlakyPrompt({ test: "x" }).messages[0].content.text;
		expect(text).toContain("test_history");
		expect(text).toContain("failure_signature_get");
	});

	it("includes the project filter when provided", () => {
		const text = whyFlakyPrompt({ test: "x", project: "core" }).messages[0].content.text;
		expect(text).toContain("core");
	});

	it("notes that node:timers need fakeNodeBuiltins to be faked", () => {
		const text = whyFlakyPrompt({ test: "x" }).messages[0].content.text;
		expect(text).toContain("node:timers");
		expect(text).toContain("node:timers/promises");
		expect(text).toContain("fakeNodeBuiltins: true");
	});

	it("names the hypothesis tool, not the stale hypothesis_record", () => {
		const text = whyFlakyPrompt({ test: "x" }).messages[0].content.text;
		expect(text).not.toContain("hypothesis_record");
		expect(text).toMatch(/`hypothesis`/);
	});

	it("frames the true-flake-vs-environmental decision", () => {
		const text = whyFlakyPrompt({ test: "x" }).messages[0].content.text;
		expect(text).toMatch(/true flake|environmental/i);
	});
});

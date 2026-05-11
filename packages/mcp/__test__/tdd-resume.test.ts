import { describe, expect, it } from "vitest";
import { tddResumePrompt } from "../src/prompts/tdd-resume.js";

describe("tddResumePrompt", () => {
	it("references the consolidated tdd_task tool", () => {
		const text = tddResumePrompt({}).messages[0].content.text;
		expect(text).toContain("tdd_task");
		expect(text).toContain('action: "resume"');
	});

	it("invokes the iron law", () => {
		const text = tddResumePrompt({}).messages[0].content.text;
		expect(text).toMatch(/iron law|cite an artifact|failing test/i);
	});

	it("includes the sessionId when provided", () => {
		const text = tddResumePrompt({ sessionId: "sess-42" }).messages[0].content.text;
		expect(text).toContain("sess-42");
	});

	it("falls back to inferred session when sessionId absent", () => {
		const text = tddResumePrompt({}).messages[0].content.text;
		expect(text).toMatch(/inferred|active session|recovered/i);
	});
});

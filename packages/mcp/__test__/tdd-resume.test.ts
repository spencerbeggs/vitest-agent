import { describe, expect, it } from "vitest";
import { tddResumePrompt } from "../src/prompts/tdd-resume.js";

describe("tddResumePrompt", () => {
	it("references tdd_session_resume", () => {
		const text = tddResumePrompt({}).messages[0].content.text;
		expect(text).toContain("tdd_session_resume");
	});

	it("invokes the iron law", () => {
		const text = tddResumePrompt({}).messages[0].content.text;
		expect(text).toMatch(/iron law|cite an artifact|failing test/i);
	});

	it("includes the cc_session_id when provided", () => {
		const text = tddResumePrompt({ cc_session_id: "sess-42" }).messages[0].content.text;
		expect(text).toContain("sess-42");
	});

	it("falls back to inferred session when cc_session_id absent", () => {
		const text = tddResumePrompt({}).messages[0].content.text;
		expect(text).toMatch(/inferred|active session/i);
	});
});

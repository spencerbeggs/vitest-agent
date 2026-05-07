import { describe, expect, it } from "vitest";
import { triagePrompt } from "../src/prompts/triage.js";

describe("triagePrompt", () => {
	it("returns a single user message", () => {
		const result = triagePrompt({});
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0].role).toBe("user");
	});

	it("references the three relevant tools", () => {
		const text = triagePrompt({}).messages[0].content.text;
		expect(text).toContain("triage_brief");
		expect(text).toContain("failure_signature_get");
		expect(text).toContain("hypothesis_record");
	});

	it("includes the project filter when provided", () => {
		const text = triagePrompt({ project: "my-app" }).messages[0].content.text;
		expect(text).toContain("my-app");
	});

	it("does NOT mention any project name when filter is absent", () => {
		const text = triagePrompt({}).messages[0].content.text;
		expect(text).not.toMatch(/project filter/i);
	});
});

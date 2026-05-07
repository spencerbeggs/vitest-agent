import { describe, expect, it } from "vitest";
import { wrapupPrompt } from "../src/prompts/wrapup.js";

describe("wrapupPrompt", () => {
	it("references the wrapup_prompt tool", () => {
		const text = wrapupPrompt({}).messages[0].content.text;
		expect(text).toContain("wrapup_prompt");
	});

	it("passes through kind and since when provided", () => {
		const text = wrapupPrompt({ kind: "stop", since: "2026-05-04T00:00:00Z" }).messages[0].content.text;
		expect(text).toContain("stop");
		expect(text).toContain("2026-05-04T00:00:00Z");
	});

	it("defaults to user_prompt_nudge when kind is omitted", () => {
		const text = wrapupPrompt({}).messages[0].content.text;
		expect(text).toContain("user_prompt_nudge");
	});
});

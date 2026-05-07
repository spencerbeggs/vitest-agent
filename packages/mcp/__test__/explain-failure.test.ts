import { describe, expect, it } from "vitest";
import { explainFailurePrompt } from "../src/prompts/explain-failure.js";

describe("explainFailurePrompt", () => {
	it("interpolates the signature into the body", () => {
		const text = explainFailurePrompt({ signature: "abc123def456abc1" }).messages[0].content.text;
		expect(text).toContain("abc123def456abc1");
	});

	it("references failure_signature_get", () => {
		const text = explainFailurePrompt({ signature: "x" }).messages[0].content.text;
		expect(text).toContain("failure_signature_get");
	});

	it("frames the new-vs-old-class distinction", () => {
		const text = explainFailurePrompt({ signature: "x" }).messages[0].content.text;
		expect(text).toMatch(/new instance|old class|recurrence/i);
	});
});

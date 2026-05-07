import { describe, expect, it } from "vitest";
import { MarkdownFormatter } from "../src/formatters/markdown.js";

describe("MarkdownFormatter", () => {
	it("has format 'markdown'", () => {
		expect(MarkdownFormatter.format).toBe("markdown");
	});

	it("renders to stdout target", () => {
		const report = {
			timestamp: new Date().toISOString(),
			reason: "passed" as const,
			summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 100 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
		};
		const outputs = MarkdownFormatter.render([report], {
			detail: "minimal",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(outputs.length).toBeGreaterThan(0);
		expect(outputs[0].target).toBe("stdout");
		expect(outputs[0].contentType).toBe("text/markdown");
	});
});

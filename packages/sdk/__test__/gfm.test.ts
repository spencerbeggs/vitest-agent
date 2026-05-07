import { describe, expect, it } from "vitest";
import { GfmFormatter } from "../src/formatters/gfm.js";

describe("GfmFormatter", () => {
	it("has format 'gfm'", () => {
		expect(GfmFormatter.format).toBe("gfm");
	});

	it("renders to github-summary target", () => {
		const report = {
			timestamp: new Date().toISOString(),
			reason: "passed" as const,
			summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 100 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
		};
		const outputs = GfmFormatter.render([report], {
			detail: "verbose",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(outputs.length).toBeGreaterThan(0);
		expect(outputs[0].target).toBe("github-summary");
		expect(outputs[0].contentType).toBe("text/markdown");
	});
});

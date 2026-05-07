import { describe, expect, it } from "vitest";
import { JsonFormatter } from "../src/formatters/json.js";

describe("JsonFormatter", () => {
	it("has format 'json'", () => {
		expect(JsonFormatter.format).toBe("json");
	});

	it("renders to stdout as application/json", () => {
		const report = {
			timestamp: new Date().toISOString(),
			reason: "passed" as const,
			summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 100 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
		};
		const outputs = JsonFormatter.render([report], {
			detail: "verbose",
			noColor: true,
			coverageConsoleLimit: 10,
		});
		expect(outputs).toHaveLength(1);
		expect(outputs[0].target).toBe("stdout");
		expect(outputs[0].contentType).toBe("application/json");
		expect(() => JSON.parse(outputs[0].content)).not.toThrow();
	});
});

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AgentReport } from "../src/schemas/AgentReport.js";

const base = {
	timestamp: "2026-11-22T00:00:00.000Z",
	reason: "passed" as const,
	summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 5 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
};

describe("AgentReport.moduleCache", () => {
	it("should round-trip an optional moduleCache stat", () => {
		// Given: a report carrying a module cache stat
		const moduleCache = { enabled: true, transformMs: 1200, trackedMs: 60000, share: 0.02, modulesWritten: 14 };

		// When: decoding and re-encoding it
		const decoded = Schema.decodeUnknownSync(AgentReport)({ ...base, moduleCache });
		const encoded = Schema.encodeSync(AgentReport)(decoded);

		// Then: the stat survives
		expect(encoded.moduleCache).toEqual(moduleCache);
	});

	it("should still decode a report with no moduleCache", () => {
		const decoded = Schema.decodeUnknownSync(AgentReport)(base);
		expect(decoded).not.toHaveProperty("moduleCache");
	});
});

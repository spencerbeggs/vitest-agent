/**
 * Schema tests for the `run.json` envelope — the versioned public
 * contract a Claude Code hook or a CI step reads off disk.
 */

import { RUN_REPORT_FILE_SCHEMA_URL, RunReportFile } from "@vitest-agent/sdk";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const validEnvelope = {
	$schema: RUN_REPORT_FILE_SCHEMA_URL,
	schemaVersion: 1,
	generatedAt: "2026-09-07T23:45:57.308Z",
	reports: [
		{
			timestamp: "2026-09-07T23:45:57.307Z",
			reason: "passed",
			summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 3.78 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
		},
	],
};

describe("RunReportFile", () => {
	it("decodes a well-formed envelope", () => {
		const parsed = Schema.decodeUnknownSync(RunReportFile)(validEnvelope);
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.$schema).toBe(RUN_REPORT_FILE_SCHEMA_URL);
		expect(parsed.reports).toHaveLength(1);
	});

	it("decodes without the optional $schema key", () => {
		const { $schema: _dropped, ...rest } = validEnvelope;
		expect(() => Schema.decodeUnknownSync(RunReportFile)(rest)).not.toThrow();
	});

	it("rejects a non-ISO generatedAt", () => {
		expect(() => Schema.decodeUnknownSync(RunReportFile)({ ...validEnvelope, generatedAt: "yesterday" })).toThrow();
	});

	it("rejects a locale date string Date.parse would otherwise accept", () => {
		expect(() => Schema.decodeUnknownSync(RunReportFile)({ ...validEnvelope, generatedAt: "Sep 7 2026" })).toThrow();
	});

	it("rejects an ISO-shaped stamp with impossible components", () => {
		expect(() =>
			Schema.decodeUnknownSync(RunReportFile)({ ...validEnvelope, generatedAt: "2026-13-45T99:99:99.000Z" }),
		).toThrow();
	});

	it("accepts an offset instant, not only a Z instant", () => {
		expect(() =>
			Schema.decodeUnknownSync(RunReportFile)({ ...validEnvelope, generatedAt: "2026-09-07T23:45:57+02:00" }),
		).not.toThrow();
	});

	it("rejects a schemaVersion other than 1", () => {
		expect(() => Schema.decodeUnknownSync(RunReportFile)({ ...validEnvelope, schemaVersion: 2 })).toThrow();
	});
});

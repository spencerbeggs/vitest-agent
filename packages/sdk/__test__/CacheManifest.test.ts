import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CacheManifest, CacheManifestEntry } from "../src/schemas/CacheManifest.js";

describe("CacheManifestEntry", () => {
	it("accepts a valid entry with all fields", () => {
		const input = {
			project: "core",
			reportFile: "reports/core.json",
			lastRun: "2026-03-20T00:00:00.000Z",
			lastResult: "passed",
		};
		const result = Schema.decodeUnknownSync(CacheManifestEntry)(input);
		expect(result).toEqual(input);
	});

	it("accepts null lastRun and lastResult", () => {
		const input = {
			project: "core",
			reportFile: "reports/core.json",
			lastRun: null,
			lastResult: null,
		};
		const result = Schema.decodeUnknownSync(CacheManifestEntry)(input);
		expect(result.lastRun).toBeNull();
		expect(result.lastResult).toBeNull();
	});

	it("accepts optional historyFile", () => {
		const input = {
			project: "core",
			reportFile: "reports/core.json",
			historyFile: "history/core.history.json",
			lastRun: "2026-03-20T00:00:00.000Z",
			lastResult: "failed",
		};
		const result = Schema.decodeUnknownSync(CacheManifestEntry)(input);
		expect(result.historyFile).toBe("history/core.history.json");
	});

	it("rejects invalid lastResult", () => {
		expect(() =>
			Schema.decodeUnknownSync(CacheManifestEntry)({
				project: "core",
				reportFile: "reports/core.json",
				lastRun: "2026-03-20T00:00:00.000Z",
				lastResult: "unknown",
			}),
		).toThrow();
	});

	it("rejects missing project", () => {
		expect(() =>
			Schema.decodeUnknownSync(CacheManifestEntry)({
				reportFile: "reports/core.json",
				lastRun: null,
				lastResult: null,
			}),
		).toThrow();
	});
});

describe("CacheManifest", () => {
	const sampleManifest = {
		updatedAt: "2026-03-20T00:00:00.000Z",
		cacheDir: ".vitest-agent",
		projects: [
			{
				project: "core",
				reportFile: "reports/core.json",
				lastRun: "2026-03-20T00:00:00.000Z",
				lastResult: "passed",
			},
		],
	};

	it("accepts a valid manifest", () => {
		const result = Schema.decodeUnknownSync(CacheManifest)(sampleManifest);
		expect(result).toEqual(sampleManifest);
	});

	it("accepts a manifest with empty projects", () => {
		const input = { ...sampleManifest, projects: [] };
		const result = Schema.decodeUnknownSync(CacheManifest)(input);
		expect(result.projects).toEqual([]);
	});

	it("accepts a manifest with multiple projects", () => {
		const input = {
			...sampleManifest,
			projects: [
				{
					project: "core",
					reportFile: "reports/core.json",
					lastRun: "2026-03-20T00:00:00.000Z",
					lastResult: "passed",
				},
				{
					project: "utils",
					reportFile: "reports/utils.json",
					lastRun: null,
					lastResult: null,
				},
			],
		};
		const result = Schema.decodeUnknownSync(CacheManifest)(input);
		expect(result.projects).toHaveLength(2);
	});

	it("rejects missing cacheDir", () => {
		const { cacheDir: _, ...noCache } = sampleManifest;
		expect(() => Schema.decodeUnknownSync(CacheManifest)(noCache)).toThrow();
	});

	it("rejects missing updatedAt", () => {
		const { updatedAt: _, ...noUpdated } = sampleManifest;
		expect(() => Schema.decodeUnknownSync(CacheManifest)(noUpdated)).toThrow();
	});
});

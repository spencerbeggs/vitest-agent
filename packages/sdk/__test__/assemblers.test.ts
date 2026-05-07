import { describe, expect, it } from "vitest";
import { assembleHistoryRecord, assembleManifest } from "../src/sql/assemblers.js";

describe("assembleManifest", () => {
	it("groups test_runs rows into CacheManifest shape", () => {
		const rows = [
			{ project: "core", sub_project: "unit", timestamp: "2026-03-22T00:00:00Z", reason: "passed" },
			{ project: "core", sub_project: "e2e", timestamp: "2026-03-22T00:00:00Z", reason: "failed" },
		];
		const manifest = assembleManifest(rows, "/path/to/db");
		expect(manifest.projects).toHaveLength(2);
		expect(manifest.projects[0].project).toBe("core:unit");
		expect(manifest.projects[1].lastResult).toBe("failed");
	});
});

describe("assembleHistoryRecord", () => {
	it("groups history rows by full_name", () => {
		const rows = [
			{ full_name: "test A", timestamp: "2026-03-22T00:00:00Z", state: "passed" },
			{ full_name: "test A", timestamp: "2026-03-21T00:00:00Z", state: "failed" },
			{ full_name: "test B", timestamp: "2026-03-22T00:00:00Z", state: "passed" },
		];
		const record = assembleHistoryRecord(rows);
		expect(Object.keys(record)).toHaveLength(2);
		expect(record["test A"].runs).toHaveLength(2);
	});
});

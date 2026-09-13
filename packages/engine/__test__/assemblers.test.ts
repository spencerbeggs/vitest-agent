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
	it("groups history rows by the composite (module_path, full_name) key", () => {
		const rows = [
			{ module_path: "src/a.test.ts", full_name: "test A", timestamp: "2026-03-22T00:00:00Z", state: "passed" },
			{ module_path: "src/a.test.ts", full_name: "test A", timestamp: "2026-03-21T00:00:00Z", state: "failed" },
			{ module_path: "src/a.test.ts", full_name: "test B", timestamp: "2026-03-22T00:00:00Z", state: "passed" },
		];
		const record = assembleHistoryRecord(rows);
		expect(Object.keys(record)).toHaveLength(2);
		const testA = Object.values(record).find((e) => e.fullName === "test A");
		expect(testA?.runs).toHaveLength(2);
		expect(testA?.modulePath).toBe("src/a.test.ts");
	});

	it("keeps two rows with the same full_name in different module_path values as distinct entries", () => {
		const rows = [
			{ module_path: "src/a.test.ts", full_name: "shared name", timestamp: "2026-03-22T00:00:00Z", state: "passed" },
			{ module_path: "src/b.test.ts", full_name: "shared name", timestamp: "2026-03-22T00:00:00Z", state: "failed" },
		];
		const record = assembleHistoryRecord(rows);
		expect(Object.keys(record)).toHaveLength(2);

		const entryA = Object.values(record).find((e) => e.modulePath === "src/a.test.ts");
		const entryB = Object.values(record).find((e) => e.modulePath === "src/b.test.ts");
		expect(entryA?.fullName).toBe("shared name");
		expect(entryB?.fullName).toBe("shared name");
		expect(entryA?.runs).toHaveLength(1);
		expect(entryB?.runs).toHaveLength(1);
		expect(entryA?.runs[0].state).toBe("passed");
		expect(entryB?.runs[0].state).toBe("failed");
	});
});

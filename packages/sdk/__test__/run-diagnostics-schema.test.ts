import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { RunDiagnostics } from "../src/schemas/RunDiagnostics.js";
import { RunReportFile } from "../src/schemas/RunReportFile.js";

const decodeDiagnostics = Schema.decodeUnknownSync(RunDiagnostics);
const decodeFile = Schema.decodeUnknownSync(RunReportFile);

const hint = (kind: string, extra: Record<string, unknown> = {}) => ({
	kind,
	message: "m",
	remedy: "r",
	detail: "d",
	learnMoreUrl: "https://vitest.dev/guide/profiling-test-performance",
	...extra,
});

describe("RunDiagnostics", () => {
	it("decodes an empty hint list", () => {
		expect(decodeDiagnostics({ performanceHints: [] })).toEqual({ performanceHints: [] });
	});

	it("decodes a full sample", () => {
		const input = {
			performanceHints: [
				hint("environment", { project: "a", estimatedSavingMs: 120, share: 0.4 }),
				hint("import", { project: "a" }),
				hint("transform"),
				hint("isolate"),
			],
			postRun: { persistMs: 10, coverageScanMs: 5, totalMs: 20, renderMs: 3, vitestDurationMs: 900 },
			persistence: { ok: false, reason: "SQLITE_CORRUPT", migrationFailed: false },
		};
		expect(decodeDiagnostics(input)).toEqual(input);
		const noRender = { performanceHints: [], postRun: { persistMs: 1, coverageScanMs: 2, totalMs: 3 } };
		expect(decodeDiagnostics(noRender)).toEqual(noRender);
		expect(decodeDiagnostics({ performanceHints: [], persistence: { ok: true } })).toEqual({
			performanceHints: [],
			persistence: { ok: true },
		});
	});

	it("rejects an unknown hint kind", () => {
		expect(() => decodeDiagnostics({ performanceHints: [hint("memory")] })).toThrow();
	});

	it("rejects non-finite timings", () => {
		expect(() =>
			decodeDiagnostics({ performanceHints: [], postRun: { persistMs: Number.NaN, coverageScanMs: 0, totalMs: 0 } }),
		).toThrow();
	});
});

describe("RunReportFile.runDiagnostics", () => {
	const base = { schemaVersion: 1, generatedAt: "2026-10-26T12:00:00.000Z", reports: [] };

	it("decodes with and without runDiagnostics", () => {
		expect(decodeFile(base).schemaVersion).toBe(1);
		const withDiag = decodeFile({ ...base, runDiagnostics: { performanceHints: [] } });
		expect(withDiag.runDiagnostics).toEqual({ performanceHints: [] });
		expect(withDiag.schemaVersion).toBe(1);
	});
});

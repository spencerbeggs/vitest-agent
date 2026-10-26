import { describe, expect, it } from "vitest";
import type { PerformanceHint, RunDiagnostics } from "../src/index.js";
import { isPostRunSlow, suggestedActionsFromRunDiagnostics } from "../src/utils/run-diagnostics-actions.js";

const hint: PerformanceHint = {
	kind: "import",
	project: "app",
	message: "Slow imports",
	remedy: "Use deps.optimizer",
	detail: "imports took 40% of the run",
	learnMoreUrl: "https://vitest.dev/x",
};

describe("isPostRunSlow", () => {
	it("is false below 5000ms with no vitest duration", () => {
		expect(isPostRunSlow({ persistMs: 0, coverageScanMs: 0, totalMs: 4999 })).toBe(false);
	});
	it("is true at 5000ms", () => {
		expect(isPostRunSlow({ persistMs: 0, coverageScanMs: 0, totalMs: 5000 })).toBe(true);
	});
	it("is false under the 1000ms floor", () => {
		expect(isPostRunSlow({ persistMs: 0, coverageScanMs: 0, totalMs: 999, vitestDurationMs: 1000 })).toBe(false);
	});
	it("is true at 10% of the vitest duration", () => {
		expect(isPostRunSlow({ persistMs: 0, coverageScanMs: 0, totalMs: 1000, vitestDurationMs: 10000 })).toBe(true);
	});
	it("is false just under 10% of the vitest duration", () => {
		expect(isPostRunSlow({ persistMs: 0, coverageScanMs: 0, totalMs: 1000, vitestDurationMs: 10001 })).toBe(false);
	});
	it("is false at 1000ms with no vitest duration", () => {
		expect(isPostRunSlow({ persistMs: 0, coverageScanMs: 0, totalMs: 1000 })).toBe(false);
	});
});

describe("suggestedActionsFromRunDiagnostics", () => {
	it("returns nothing for empty diagnostics", () => {
		expect(suggestedActionsFromRunDiagnostics({ performanceHints: [] })).toEqual([]);
	});

	it("maps a hint with a project", () => {
		expect(suggestedActionsFromRunDiagnostics({ performanceHints: [hint] })).toEqual([
			{
				severity: "info",
				title: "app: Slow imports",
				detail: "Use deps.optimizer — imports took 40% of the run (https://vitest.dev/x)",
			},
		]);
	});

	it("omits the project prefix for a run-wide hint", () => {
		const { project: _p, ...runWide } = hint;
		const [a] = suggestedActionsFromRunDiagnostics({ performanceHints: [runWide] });
		expect(a?.title).toBe("Slow imports");
	});

	it("yields nothing when persistence is ok", () => {
		expect(suggestedActionsFromRunDiagnostics({ performanceHints: [], persistence: { ok: true } })).toEqual([]);
	});

	it("suggests db reset when a migration failed", () => {
		const [a] = suggestedActionsFromRunDiagnostics({
			performanceHints: [],
			persistence: { ok: false, reason: "bad migration", migrationFailed: true },
		});
		expect(a).toEqual({
			severity: "warn",
			title: "Results were not saved",
			detail: "bad migration. Run `vitest-agent db reset` to recreate the database.",
		});
	});

	it("falls back to unknown error when a migration failure has no reason", () => {
		const [a] = suggestedActionsFromRunDiagnostics({
			performanceHints: [],
			persistence: { ok: false, migrationFailed: true },
		});
		expect(a?.detail).toBe("unknown error. Run `vitest-agent db reset` to recreate the database.");
	});

	it("uses the reason, or a fallback, for other persistence failures", () => {
		const d = (reason?: string): RunDiagnostics => ({
			performanceHints: [],
			persistence: reason === undefined ? { ok: false } : { ok: false, reason },
		});
		expect(suggestedActionsFromRunDiagnostics(d("disk full"))[0]?.detail).toBe("disk full");
		expect(suggestedActionsFromRunDiagnostics(d())[0]?.detail).toBe("unknown error");
	});

	it("formats the slow post-run title", () => {
		const [a] = suggestedActionsFromRunDiagnostics({
			performanceHints: [],
			postRun: { persistMs: 18200, coverageScanMs: 5900, totalMs: 24100 },
		});
		expect(a?.severity).toBe("warn");
		expect(a?.title).toBe("Post-run work took 24.1s (persist 18.2s, coverage scan 5.9s)");
		expect(a?.detail).toBe(
			"Time vitest-agent spent after Vitest finished. Set persist: false where history is not needed (e.g. CI), or narrow coverage.include.",
		);
	});

	it("does not flag a fast post-run", () => {
		expect(
			suggestedActionsFromRunDiagnostics({
				performanceHints: [],
				postRun: { persistMs: 1, coverageScanMs: 1, totalMs: 2 },
			}),
		).toEqual([]);
	});

	it("orders persistence, slow post-run, then hints", () => {
		const out = suggestedActionsFromRunDiagnostics({
			performanceHints: [hint, { ...hint, project: "lib" }],
			postRun: { persistMs: 5000, coverageScanMs: 0, totalMs: 5000 },
			persistence: { ok: false, reason: "x" },
		});
		expect(out.map((a) => a.title)).toEqual([
			"Results were not saved",
			"Post-run work took 5.0s (persist 5.0s, coverage scan 0.0s)",
			"app: Slow imports",
			"lib: Slow imports",
		]);
	});
});

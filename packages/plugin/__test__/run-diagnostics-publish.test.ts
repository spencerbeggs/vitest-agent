/**
 * Issue #544: the run's diagnostics are published on the Vitest instance
 * under a `Symbol.for` slot so the MCP `run_tests` tool, which runs Vitest
 * in-process, can read them back without importing the plugin. Any defined
 * diagnostics are published (a clean run still carries post-run timing); only
 * `undefined` clears the slot so a watch-mode rerun never reports a stale one.
 */

import type { RunDiagnostics } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { RUN_DIAGNOSTICS_SYMBOL, publishRunDiagnostics } from "../src/utils/run-diagnostics.js";

const slot = (vitest: object): unknown => (vitest as Record<symbol, unknown>)[RUN_DIAGNOSTICS_SYMBOL];

const clean: RunDiagnostics = {
	performanceHints: [],
	postRun: { persistMs: 10, coverageScanMs: 5, totalMs: 15, vitestDurationMs: 1000 },
	persistence: { ok: true },
};

describe("publishRunDiagnostics", () => {
	it("uses the shared Symbol.for key", () => {
		expect(RUN_DIAGNOSTICS_SYMBOL).toBe(Symbol.for("vitest-agent:run-diagnostics"));
	});

	it("stores diagnostics carrying a persistence failure", () => {
		const vitest = {};
		const d: RunDiagnostics = { ...clean, persistence: { ok: false, reason: "disk full" } };
		publishRunDiagnostics(vitest, d);
		expect(slot(vitest)).toEqual(d);
	});

	it("stores diagnostics carrying a performance hint", () => {
		const vitest = {};
		const d: RunDiagnostics = {
			...clean,
			performanceHints: [{ kind: "isolate", message: "m", remedy: "r", detail: "d", learnMoreUrl: "u" }],
		};
		publishRunDiagnostics(vitest, d);
		expect(slot(vitest)).toEqual(d);
	});

	it("stores diagnostics whose post-run work was slow", () => {
		const vitest = {};
		const d: RunDiagnostics = { ...clean, postRun: { persistMs: 6000, coverageScanMs: 0, totalMs: 6000 } };
		publishRunDiagnostics(vitest, d);
		expect(slot(vitest)).toEqual(d);
	});

	it("publishes clean diagnostics with postRun, overwriting the previous run", () => {
		const vitest = {};
		publishRunDiagnostics(vitest, { ...clean, persistence: { ok: false, reason: "x" } });
		publishRunDiagnostics(vitest, clean);
		expect(slot(vitest)).toEqual(clean);
		expect((slot(vitest) as RunDiagnostics).performanceHints).toEqual([]);
		expect((slot(vitest) as RunDiagnostics).postRun).toBeDefined();
	});

	it("clears the slot for undefined", () => {
		const vitest = {};
		publishRunDiagnostics(vitest, { ...clean, persistence: { ok: false, reason: "x" } });
		publishRunDiagnostics(vitest, undefined);
		expect(slot(vitest)).toBeUndefined();
	});
});

import { describe, expect, it } from "vitest";
import type { RunEvent } from "vitest-agent-sdk";
import { createLiveInk } from "../src/LiveInkRenderer.js";

/**
 * Vitest's stdout shimming breaks Ink's `new console.Console(...)`
 * call, so we cannot mount the real Ink renderer inside a unit
 * test. These cases verify the orchestration logic — state
 * accumulation, lifecycle idempotency, event-handler resilience —
 * while letting Ink fail its mount silently. The actual rendered
 * frame is exercised end-to-end by running `pnpm vitest run` with
 * `console.human: "ink"` configured.
 */

describe("createLiveInk — orchestration", () => {
	it("snapshot advances through events even when mount fails", () => {
		const live = createLiveInk();
		const events: RunEvent[] = [
			{ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" },
			{ _tag: "ModuleQueued", modulePath: "a.test.ts" },
			{ _tag: "ModuleStarted", modulePath: "a.test.ts", startedAt: "T0" },
			{
				_tag: "TestFinished",
				modulePath: "a.test.ts",
				testName: "x",
				suitePath: [],
				status: "passed",
				durationMs: 1,
			},
			{
				_tag: "ModuleFinished",
				modulePath: "a.test.ts",
				passCount: 1,
				failCount: 0,
				skipCount: 0,
				durationMs: 1,
			},
		];
		// stderr is muted to silence the "live ink renderer failed" warning
		// that fires under vitest's stdout shim.
		const originalWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = (() => true) as typeof process.stderr.write;
		try {
			for (const e of events) {
				live.event(e);
			}
		} finally {
			process.stderr.write = originalWrite;
		}
		const snap = live.snapshot();
		expect(snap.phase).toBe("running");
		expect(snap.modules["a.test.ts"]).toMatchObject({ passCount: 1, status: "finished" });
		live.unmount();
	});

	it("unmount is idempotent before any event has fired", () => {
		const live = createLiveInk();
		expect(() => {
			live.unmount();
			live.unmount();
		}).not.toThrow();
	});

	it("snapshot reflects RunFinished totals", () => {
		const live = createLiveInk();
		const originalWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = (() => true) as typeof process.stderr.write;
		try {
			live.event({ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" });
			live.event({
				_tag: "RunFinished",
				runId: "r1",
				finishedAt: "T1",
				passCount: 5,
				failCount: 2,
				skipCount: 0,
				durationMs: 100,
			});
		} finally {
			process.stderr.write = originalWrite;
		}
		const snap = live.snapshot();
		expect(snap.phase).toBe("finished");
		expect(snap.totals).toEqual({ passCount: 5, failCount: 2, skipCount: 0, durationMs: 100 });
	});

	it("exposes a stable event handler reference suitable for AgentPlugin onRunEvent", () => {
		const live = createLiveInk();
		expect(typeof live.event).toBe("function");
		expect(typeof live.unmount).toBe("function");
		expect(typeof live.snapshot).toBe("function");
		live.unmount();
	});
});

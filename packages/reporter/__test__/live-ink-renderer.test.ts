import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { RunEvent } from "vitest-agent-sdk";
import { createLiveInk } from "../src/LiveInkRenderer.js";

/** Run `fn` with `process.stderr.write` muted (mount degrades under the shim). */
const muteStderr = (fn: () => void): void => {
	const originalWrite = process.stderr.write.bind(process.stderr);
	process.stderr.write = (() => true) as typeof process.stderr.write;
	try {
		fn();
	} finally {
		process.stderr.write = originalWrite;
	}
};

/**
 * Create a writable stream that accumulates all written chunks as a string.
 * Pass `{ tty: true }` to mark it as a TTY (sets `isTTY` plus the `columns` /
 * `rows` Ink reads) so the clear-at-mount path engages.
 */
const captureStream = (opts: { tty?: boolean } = {}): { stream: NodeJS.WriteStream; output: () => string } => {
	const chunks: string[] = [];
	const writable = new Writable({
		write(chunk: Buffer | string, _encoding, callback) {
			chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
			callback();
		},
	});
	if (opts.tty === true) {
		Object.defineProperty(writable, "isTTY", { value: true, configurable: true });
		Object.defineProperty(writable, "columns", { value: 100, configurable: true });
		Object.defineProperty(writable, "rows", { value: 40, configurable: true });
	}
	// Cast to NodeJS.WriteStream — tests only use write(); other TTY methods
	// are unused in the tested paths.
	return {
		stream: writable as unknown as NodeJS.WriteStream,
		output: () => chunks.join(""),
	};
};

const runStarted: RunEvent = { _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" };
const runFinished: RunEvent = {
	_tag: "RunFinished",
	runId: "r1",
	finishedAt: "T1",
	passCount: 1,
	failCount: 0,
	skipCount: 0,
	durationMs: 1,
};

/**
 * Vitest's stdout shimming breaks Ink's `new console.Console(...)`
 * call, so we cannot mount the real Ink renderer inside a unit
 * test. These cases verify the orchestration logic — state
 * accumulation, lifecycle idempotency, event-handler resilience —
 * while letting Ink fail its mount silently. The actual rendered
 * frame is exercised end-to-end by running `pnpm vitest run` with
 * `console.human: "stream"` configured.
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
		const { stream } = captureStream();
		const live = createLiveInk({ stream });
		muteStderr(() => {
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
		});
		const snap = live.snapshot();
		expect(snap.phase).toBe("finished");
		expect(snap.totals).toEqual({ passCount: 5, failCount: 2, skipCount: 0, timeoutCount: 0, durationMs: 100 });
	});

	it("exposes a stable event handler reference suitable for AgentPlugin onRunEvent", () => {
		const live = createLiveInk();
		expect(typeof live.event).toBe("function");
		expect(typeof live.unmount).toBe("function");
		expect(typeof live.snapshot).toBe("function");
		live.unmount();
	});
});

describe("createLiveInk — animation clock lifecycle", () => {
	it("starts the clock on RunStarted and clears it on RunFinished", () => {
		const setSpy = vi.spyOn(globalThis, "setInterval");
		const clearSpy = vi.spyOn(globalThis, "clearInterval");
		const { stream } = captureStream();
		try {
			const live = createLiveInk({ stream });
			const beforeStart = setSpy.mock.calls.length;
			muteStderr(() => {
				live.event(runStarted);
			});
			// The clock is created in the RunStarted branch.
			expect(setSpy.mock.calls.length).toBeGreaterThan(beforeStart);

			const beforeFinish = clearSpy.mock.calls.length;
			muteStderr(() => {
				live.event(runFinished);
			});
			// The terminal event stops the clock.
			expect(clearSpy.mock.calls.length).toBeGreaterThan(beforeFinish);
			live.unmount();
		} finally {
			setSpy.mockRestore();
			clearSpy.mockRestore();
		}
	});

	it("clears the clock on a RunTimedOut terminal event", () => {
		const clearSpy = vi.spyOn(globalThis, "clearInterval");
		const { stream } = captureStream();
		try {
			const live = createLiveInk({ stream });
			const before = clearSpy.mock.calls.length;
			muteStderr(() => {
				live.event(runStarted);
				live.event({ _tag: "RunTimedOut", message: "process timeout" });
			});
			expect(clearSpy.mock.calls.length).toBeGreaterThan(before);
			live.unmount();
		} finally {
			clearSpy.mockRestore();
		}
	});

	it("clears an active clock on unmount and stays idempotent on a second call", () => {
		const clearSpy = vi.spyOn(globalThis, "clearInterval");
		try {
			const live = createLiveInk();
			muteStderr(() => {
				live.event(runStarted);
			});
			const before = clearSpy.mock.calls.length;
			live.unmount();
			expect(clearSpy.mock.calls.length).toBeGreaterThan(before);
			// A second unmount must not throw and must not re-clear a
			// cleared interval.
			expect(() => live.unmount()).not.toThrow();
		} finally {
			clearSpy.mockRestore();
		}
	});

	it("does not start a clock before any event fires", () => {
		const setSpy = vi.spyOn(globalThis, "setInterval");
		try {
			const before = setSpy.mock.calls.length;
			const live = createLiveInk();
			expect(setSpy.mock.calls.length).toBe(before);
			live.unmount();
		} finally {
			setSpy.mockRestore();
		}
	});
});

describe("createLiveInk — terminal event writes plain-text final frame", () => {
	it("writes a non-empty plain-text final frame to the stream on RunFinished", () => {
		const { stream, output } = captureStream();
		const live = createLiveInk({ stream });
		muteStderr(() => {
			live.event({ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" });
			live.event({
				_tag: "ModuleStarted",
				modulePath: "a.test.ts",
				startedAt: "T0",
			});
			live.event({
				_tag: "ModuleFinished",
				modulePath: "a.test.ts",
				passCount: 3,
				failCount: 0,
				skipCount: 0,
				durationMs: 10,
			});
			live.event({
				_tag: "RunFinished",
				runId: "r1",
				finishedAt: "T1",
				passCount: 3,
				failCount: 0,
				skipCount: 0,
				durationMs: 10,
			});
		});
		const written = output();
		// A non-empty frame was written — it should contain the total line.
		expect(written.length).toBeGreaterThan(0);
		expect(written).toContain("Total:");
		// No Ink mount occurred (degraded), but the plain-text write still
		// happened.
		live.unmount();
	});

	it("writes a plain-text final frame on RunTimedOut", () => {
		const { stream, output } = captureStream();
		const live = createLiveInk({ stream });
		muteStderr(() => {
			live.event({ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" });
			live.event({ _tag: "RunTimedOut", message: "process timeout" });
		});
		const written = output();
		expect(written.length).toBeGreaterThan(0);
		live.unmount();
	});

	it("unmounts on the terminal event and mounts fresh on the next run", { timeout: 60000 }, async () => {
		// On a terminal event the renderer unmounts the Ink instance (Ink
		// commits the final frame to scrollback). `firstRunStarted` is reset
		// so the next `RunStarted` mounts a fresh instance — not a clear() on
		// the torn-down handle. We mock ink.render and count mount / unmount /
		// clear calls.
		const mountCalls: number[] = [];
		const unmountCalls: number[] = [];
		const clearCalls: number[] = [];
		vi.resetModules();
		vi.doMock("ink", async () => {
			const actual = await vi.importActual<typeof import("ink")>("ink");
			return {
				...actual,
				render: vi.fn(() => {
					mountCalls.push(Date.now());
					return {
						rerender: () => {},
						unmount: () => {
							unmountCalls.push(Date.now());
						},
						cleanup: () => {},
						clear: () => {
							clearCalls.push(Date.now());
						},
						waitUntilExit: () => Promise.resolve(),
						waitUntilRenderFlush: () => Promise.resolve(),
					};
				}),
			};
		});
		try {
			const { stream } = captureStream();
			const mod = await import("../src/LiveInkRenderer.js");
			const live = mod.createLiveInk({ stream });
			// First run.
			live.event({ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" });
			expect(mountCalls.length).toBe(1);
			expect(unmountCalls.length).toBe(0);
			live.event({
				_tag: "RunFinished",
				runId: "r1",
				finishedAt: "T1",
				passCount: 0,
				failCount: 0,
				skipCount: 0,
				durationMs: 1,
			});
			// The terminal event unmounts (Ink commits the final frame) and
			// never reaches for clear() on a live instance.
			expect(unmountCalls.length).toBe(1);
			expect(clearCalls.length).toBe(0);
			// Second run — must mount a fresh instance.
			const mountsBefore = mountCalls.length;
			live.event({ _tag: "RunStarted", runId: "r2", startedAt: "T2", configHash: "h" });
			expect(mountCalls.length).toBe(mountsBefore + 1);
			live.event({
				_tag: "RunFinished",
				runId: "r2",
				finishedAt: "T3",
				passCount: 0,
				failCount: 0,
				skipCount: 0,
				durationMs: 1,
			});
			expect(unmountCalls.length).toBe(2);
			live.unmount();
		} finally {
			vi.doUnmock("ink");
			vi.resetModules();
		}
	});
});

describe("createLiveInk — watch-mode rerun", () => {
	it("processes a second RunStarted without crashing on the same handle", () => {
		// Watch mode: the terminal event unmounts the Ink instance and resets
		// `firstRunStarted`. The next `RunStarted` mounts a fresh instance
		// and the reducer reflects only the new run.
		const { stream } = captureStream();
		const live = createLiveInk({ stream });
		muteStderr(() => {
			live.event(runStarted);
			live.event(runFinished);
			// Second run on the same handle — fresh mount after terminal event.
			live.event({ _tag: "RunStarted", runId: "r2", startedAt: "T2", configHash: "h" });
			live.event({
				_tag: "ModuleStarted",
				modulePath: "a.test.ts",
				startedAt: "T2",
			});
			live.event({
				_tag: "RunFinished",
				runId: "r2",
				finishedAt: "T3",
				passCount: 1,
				failCount: 0,
				skipCount: 0,
				durationMs: 1,
			});
		});
		// The reducer is shared across runs through the renderer; the
		// second `RunStarted` resets `RenderState` (reducer reset),
		// so the final snapshot reflects only the second run.
		const snap = live.snapshot();
		expect(snap.runId).toBe("r2");
		expect(snap.phase).toBe("finished");
		expect(snap.modules["a.test.ts"]).toBeDefined();
		live.unmount();
	});
});

// ---------------------------------------------------------------------------
// Terminal-event commit: Ink owns the final-frame write
// ---------------------------------------------------------------------------

describe("createLiveInk — terminal-event commit via unmount", () => {
	it("calls unmount and emits no manual cursor-up + erase sequence on RunFinished", { timeout: 60000 }, async () => {
		// The renderer must let Ink commit the final frame on unmount and
		// never emit a manual `CSI N F + CSI 0 J` extra-clear of its own —
		// that machinery fought Ink's cursor accounting and left stale
		// frames in scrollback. We mock ink so its unmount writes nothing,
		// then assert the captured stream carries no extra-clear sequence.
		vi.resetModules();
		const unmountCalls: number[] = [];
		const chunks: string[] = [];
		const underlying = new Writable({
			write(chunk: Buffer | string, _enc, cb) {
				chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
				cb();
			},
		});
		const stream = underlying as unknown as NodeJS.WriteStream;
		vi.doMock("ink", async () => {
			const actual = await vi.importActual<typeof import("ink")>("ink");
			return {
				...actual,
				render: vi.fn(() => ({
					rerender: () => {},
					unmount: () => {
						unmountCalls.push(Date.now());
					},
					cleanup: () => {},
					clear: () => {},
					waitUntilExit: () => Promise.resolve(),
					waitUntilRenderFlush: () => Promise.resolve(),
				})),
			};
		});
		try {
			const mod = await import("../src/LiveInkRenderer.js");
			const live = mod.createLiveInk({ stream });
			live.event({ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" });
			live.event({
				_tag: "RunFinished",
				runId: "r1",
				finishedAt: "T1",
				passCount: 1,
				failCount: 0,
				skipCount: 0,
				durationMs: 1,
			});
			expect(unmountCalls.length).toBe(1);
			const allOutput = chunks.join("");
			// No ANSI cursor-previous-line + erase-to-end sequence.
			// Use new RegExp to avoid Biome's noControlCharactersInRegex rule.
			const ESC = String.fromCharCode(27);
			const ansiExtraClear = new RegExp(`${ESC}\\[\\d+F${ESC}\\[0J`);
			expect(allOutput).not.toMatch(ansiExtraClear);
			live.unmount();
		} finally {
			vi.doUnmock("ink");
			vi.resetModules();
		}
	});

	it("writes a plain-text final frame only when the Ink mount degraded", () => {
		// Under Vitest's stdout shim the real Ink mount throws, so `instance`
		// stays null. The terminal event must still surface the run result by
		// writing a plain-text final frame to the stream.
		const { stream, output } = captureStream();
		const live = createLiveInk({ stream });
		muteStderr(() => {
			live.event({ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" });
			live.event({
				_tag: "ModuleFinished",
				modulePath: "a.test.ts",
				passCount: 3,
				failCount: 0,
				skipCount: 0,
				durationMs: 10,
			});
			live.event({
				_tag: "RunFinished",
				runId: "r1",
				finishedAt: "T1",
				passCount: 3,
				failCount: 0,
				skipCount: 0,
				durationMs: 10,
			});
		});
		expect(output()).toContain("Total:");
		live.unmount();
	});
});

// ---------------------------------------------------------------------------
// Clear-at-mount: anchor Ink's dynamic region at row 0
// ---------------------------------------------------------------------------

describe("createLiveInk — clear-at-mount scroll anchoring", () => {
	it("clears the screen and homes the cursor on the first RunStarted when stdout is a TTY", () => {
		// Mounting clears the screen so Ink's dynamic region is anchored at
		// row 0. When the anchor sits mid-screen (below pnpm's banner) a
		// growing Live frame scrolls the terminal and Ink's eraseLines can no
		// longer reach the lines that slid out, stranding a stale partial
		// frame. The clear sequence engages even though Vitest's stdout shim
		// makes the subsequent Ink mount degrade — it is written before the
		// mount call.
		const { stream, output } = captureStream({ tty: true });
		const live = createLiveInk({ stream });
		muteStderr(() => {
			live.event({ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" });
		});
		// CSI 2 J (erase screen) + CSI H (cursor home). Use new RegExp to
		// avoid Biome's noControlCharactersInRegex rule.
		const ESC = String.fromCharCode(27);
		expect(output()).toContain(`${ESC}[2J${ESC}[H`);
		live.unmount();
	});

	it("does not emit the clear sequence when stdout is not a TTY", () => {
		// Piped / non-interactive consumers must not receive raw clear escapes;
		// they take the plain-text fallback instead.
		const { stream, output } = captureStream();
		const live = createLiveInk({ stream });
		muteStderr(() => {
			live.event({ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h" });
		});
		const ESC = String.fromCharCode(27);
		expect(output()).not.toContain(`${ESC}[2J`);
		live.unmount();
	});
});

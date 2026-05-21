/**
 * Imperative live-mount Ink renderer driven by streaming
 * {@link RunEvent}s. Holds its own reducer state, an Ink mount handle,
 * and an animation clock across the lifetime of a test run — and across
 * watch-mode reruns.
 *
 * Mount happens on the first `RunStarted` event so the renderer doesn't
 * compete with Vitest's stdout setup. The mount clears the screen and
 * homes the cursor first, anchoring Ink's dynamic region at row 0 — see
 * the scroll-anchoring note on `mount` below. Each subsequent event folds
 * the state forward and rerenders the {@link StreamApp} tree.
 *
 * ### Terminal-event commit
 *
 * On the terminal event (`RunFinished` / `RunTimedOut`) the renderer
 * stops the clock and calls `instance.unmount()`. Ink's interactive
 * unmount path flushes any pending throttled render and then draws the
 * current (final) frame one last time — erasing the previous frame's
 * lines first via `eraseLines` — before calling log-update's `done()`,
 * which shows the cursor and leaves the frame in place. The final frame
 * therefore lands at the dynamic region's anchor and is committed to
 * terminal scrollback as ordinary terminal content. No manual
 * `clear()`, cursor math, or plain-text re-write is involved: those
 * fought Ink's own cursor accounting and left stale frames behind. We
 * let Ink commit the final frame itself.
 *
 * When Ink's mount degrades (a non-TTY stream, Vitest's stdout shim),
 * `instance` stays null and no frame was ever painted. In that case the
 * terminal event writes a plain-text final frame via `renderToString`
 * so non-interactive consumers still receive the run result.
 *
 * Watch mode: after the terminal-event unmount, `firstRunStarted` is
 * reset so the next `RunStarted` mounts a fresh Ink instance below the
 * previous run's committed final frame.
 *
 * The animation clock is a `setInterval` that rerenders on a fixed
 * cadence so the spinner glyph and the ticking elapsed column advance
 * between discrete events. It is **started in the `RunStarted` branch**
 * — not on mount — because watch mode mounts once and runs many times;
 * a mount-scoped clock would leave the second run un-animated. It is
 * stopped on the terminal event and again, defensively, in `tearDown`
 * (the forked drain fiber that feeds events is never cancelled, so the
 * interval must not outlive the instance).
 *
 * The spinner frame index is derived from wall-clock time, so it is
 * automatically correct across watch-mode remounts with no counter to
 * reset. It is presentation state and never enters `RenderState`.
 *
 * @packageDocumentation
 */

import { render as inkRender, renderToString } from "ink";
import { createElement } from "react";
import type { RenderState, RunEvent } from "vitest-agent-sdk";
import { initialRenderState } from "vitest-agent-sdk";
import { SPINNER_FRAME_MS, StreamApp, reduceRenderState, spinnerFrameForTime } from "vitest-agent-ui";

export interface CreateLiveInkOptions {
	/**
	 * Override the stream Ink writes to. Defaults to `process.stdout`.
	 * Tests pass a captured Writable here to assert on rendered frames.
	 */
	readonly stream?: NodeJS.WriteStream;
}

export interface LiveInkRenderer {
	/**
	 * Process a {@link RunEvent}. Mounts the Ink tree and starts the
	 * animation clock on `RunStarted`, rerenders on every event that
	 * mutates state, and unmounts on the terminal event so Ink commits
	 * the final frame to scrollback.
	 */
	readonly event: (event: RunEvent) => void;
	/**
	 * Force an immediate unmount and stop the animation clock. Safe to
	 * call multiple times. Useful in tests or when the host needs to
	 * tear down out of band (e.g. a cancellation signal).
	 */
	readonly unmount: () => void;
	/**
	 * Latest reduced state. Exposed for hosts that want to assert on the
	 * accumulated value at any point during the run.
	 */
	readonly snapshot: () => RenderState;
}

type InkInstance = ReturnType<typeof inkRender>;

export const createLiveInk = (options: CreateLiveInkOptions = {}): LiveInkRenderer => {
	let state: RenderState = initialRenderState;
	let instance: InkInstance | null = null;
	let clock: ReturnType<typeof setInterval> | null = null;
	// After a terminal event the Ink instance is unmounted (Ink commits
	// the final frame to scrollback). `firstRunStarted` is reset to false
	// so the next `RunStarted` mounts a fresh instance below the previous
	// run's committed frame.
	let firstRunStarted = false;

	// The stream Ink writes to, and the plain-text fallback writes to when
	// the Ink mount degrades.
	const targetStream: NodeJS.WriteStream = options.stream ?? process.stdout;

	const renderTree = () => {
		const now = Date.now();
		return createElement(StreamApp, { state, frameIndex: spinnerFrameForTime(now), nowMs: now });
	};

	const mount = () => {
		if (instance !== null) return;
		// Clear the screen and home the cursor before mounting so Ink's
		// dynamic region is anchored at row 0. Ink's scroll/overflow handling
		// assumes the region owns the viewport from its anchor downward; when
		// the anchor sits mid-screen (below pnpm's banner) a growing Live
		// frame scrolls the terminal and Ink's `eraseLines` can no longer
		// reach the lines that slid out of the dynamic region, leaving a
		// stale partial frame (the "Projects (N):" leak). Anchoring at row 0
		// keeps Ink's accounting correct: the frame either fits the viewport
		// or trips Ink's own fullscreen redraw, and never strands lines.
		// Guarded on `isTTY` so piped / non-interactive output stays free of
		// raw escape sequences (those consumers take the plain-text fallback).
		if (targetStream.isTTY === true) {
			// CSI 2 J → erase entire screen; CSI H → cursor to home (row 1,1).
			targetStream.write("\x1b[2J\x1b[H");
		}
		instance = inkRender(renderTree(), { stdout: targetStream });
	};

	const stopClock = () => {
		if (clock === null) return;
		clearInterval(clock);
		clock = null;
	};

	const startClock = () => {
		if (clock !== null) return;
		clock = setInterval(() => {
			// The clock advances the spinner and the elapsed column
			// between discrete events. A mount that silently degraded
			// (non-TTY) leaves `instance` null — nothing to rerender.
			if (instance === null) return;
			try {
				instance.rerender(renderTree());
			} catch {
				instance = null;
				stopClock();
			}
		}, SPINNER_FRAME_MS);
		// Do not keep the event loop alive solely for the spinner.
		clock.unref?.();
	};

	const tearDown = () => {
		// Defensive: the forked drain fiber feeding events is never
		// cancelled, so the interval must be cleared here even if the
		// terminal event never arrived.
		stopClock();
		if (instance === null) return;
		instance.unmount();
		instance = null;
		// After a full teardown, a subsequent `RunStarted` should mount a
		// fresh instance (not call `clear()` on a null one). Reset the
		// first-run flag so the next mount-event path goes through
		// `mount()` again.
		firstRunStarted = false;
	};

	return {
		event(event: RunEvent): void {
			const previousPhase = state.phase;
			state = reduceRenderState(state, event);

			// Mount and rerender are wrapped because Ink's mount can throw
			// in non-TTY environments (Vitest's stdout shim, piped output).
			// The orchestration must keep advancing state regardless — hosts
			// rely on `snapshot()` even when the visible mount silently
			// degrades.
			const isMountEvent = event._tag === "RunStarted" || (previousPhase === "idle" && state.phase !== "idle");
			if (isMountEvent) {
				if (firstRunStarted) {
					// Defensive: a second `RunStarted` arrived without a
					// terminal event — the Ink instance may still be mounted.
					// Call `instance.clear()` to reset the visible Live region
					// so the new run paints into a clean area.
					if (instance !== null) {
						try {
							instance.clear();
						} catch {
							// `clear()` is best-effort; a thrown error from
							// the non-interactive log shim must not derail
							// the run.
						}
					}
				} else {
					try {
						mount();
					} catch (err) {
						process.stderr.write(
							`vitest-agent-reporter: live ink renderer failed; falling back silently (${(err as Error).message})\n`,
						);
						instance = null;
					}
				}
				firstRunStarted = true;
				// Start the clock in the `RunStarted` branch, not in
				// `mount()` — watch mode mounts once and runs many times; a
				// mount-scoped clock would leave every run after the first
				// un-animated. Started even when the mount degraded: the
				// clock's rerender is a no-op while `instance` is null and
				// is cleared on the terminal event regardless.
				startClock();
			} else if (instance !== null) {
				try {
					instance.rerender(renderTree());
				} catch (err) {
					process.stderr.write(
						`vitest-agent-reporter: live ink renderer failed; falling back silently (${(err as Error).message})\n`,
					);
					instance = null;
					stopClock();
				}
			}

			// `RunFinished` and `RunTimedOut` are both terminal. Stop the
			// clock and unmount the Ink instance. Ink's interactive unmount
			// flushes the pending render, redraws the final frame one last
			// time (erasing the previous frame first), then leaves it in
			// place via log-update's `done()` — committing the final frame
			// to scrollback as ordinary terminal content. When the mount
			// degraded (`instance` is null), no frame was ever painted, so
			// write a plain-text final frame so non-interactive consumers
			// still receive the run result. Watch mode: `firstRunStarted` is
			// reset so the next `RunStarted` mounts a fresh instance below
			// the committed frame.
			if (event._tag === "RunFinished" || event._tag === "RunTimedOut") {
				stopClock();
				if (instance !== null) {
					try {
						instance.unmount();
					} catch {
						// best-effort
					}
					instance = null;
				} else {
					const now = Date.now();
					const finalFrameText = renderToString(
						createElement(StreamApp, { state, frameIndex: spinnerFrameForTime(now), nowMs: now }),
					);
					targetStream.write(`${finalFrameText}\n`);
				}
				firstRunStarted = false;
			}
		},
		unmount(): void {
			tearDown();
		},
		snapshot(): RenderState {
			return state;
		},
	};
};

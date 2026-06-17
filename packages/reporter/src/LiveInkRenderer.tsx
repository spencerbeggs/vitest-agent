/**
 * Imperative live-mount Ink renderer driven by streaming
 * {@link RunEvent}s. Holds its own reducer state, an Ink mount handle,
 * and an animation clock across the lifetime of a test run — and across
 * watch-mode reruns.
 *
 * Mount happens on the first `RunStarted` event so the renderer doesn't
 * compete with Vitest's stdout setup. Ink mounts inline, where the cursor
 * already sits — the renderer does not wipe the screen (see the note on
 * `mount` below for why the earlier clear-at-mount was dropped). Each
 * subsequent event folds the state forward and rerenders the
 * {@link StreamApp} tree.
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

import type { RenderState, RunEvent } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { SPINNER_FRAME_MS, StreamApp, reduceRenderState, spinnerFrameForTime } from "@vitest-agent/ui";
import { Box, render as inkRender, renderToString } from "ink";
import { createElement } from "react";

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

	// Constrain Ink's layout to one column narrower than the terminal so no
	// rendered line ever exactly fills the width. Ink tracks frame height by
	// counting the `\n`s in its own output and erases exactly that many lines
	// each frame (`log-update`'s `eraseLines(previousLineCount)`); it has no
	// notion of the terminal physically wrapping a line. A line whose width
	// equals the terminal's column count triggers the terminal's auto-wrap,
	// occupying two physical rows while Ink still counts it as one — so the
	// next erase comes up short and strands the top rows (the duplicated
	// "Projects (N):" header). At a narrow width many rows over-wrap and the
	// header duplicates many times over; at a wide width a single over-wide
	// row strands a single copy. Wrapping at `columns - 1` keeps every emitted
	// line strictly narrower than the terminal, so Ink's logical line count
	// always equals the physical rows and `eraseLines` is always exact.
	// Re-read every render so a mid-run resize is picked up. Undefined when the
	// stream reports no width (non-TTY) — the wrap Box simply imposes no limit.
	const frameWidth = (): number | undefined => {
		const cols = targetStream.columns;
		return typeof cols === "number" && cols > 1 ? cols - 1 : undefined;
	};

	const frameElement = () => {
		const now = Date.now();
		return createElement(
			Box,
			{ flexDirection: "column", width: frameWidth() },
			createElement(StreamApp, { state, frameIndex: spinnerFrameForTime(now), nowMs: now }),
		);
	};

	const mount = () => {
		if (instance !== null) return;
		// Mount Ink inline, where the cursor already sits — no screen wipe.
		// An earlier revision cleared the whole screen and homed the cursor
		// (CSI 2J / CSI H) on mount, to anchor Ink's dynamic region at row 0
		// so a growing frame could never scroll past the viewport top and
		// strand lines (the "Projects (N):" leak). That trade-off wasn't
		// worth it: the wipe destroys the user's scrollback and the
		// preceding command output (pnpm's banner, the `$ vitest run` line)
		// on every run, and on terminals that ignore the escape it bought
		// nothing anyway. We accept the rare terminal-specific strand instead
		// of nuking the console, and let Ink render in place like an ordinary
		// progressive reporter. The frame-width clamp in `frameWidth` keeps
		// Ink's line accounting correct for the common case.
		instance = inkRender(frameElement(), { stdout: targetStream });
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
				instance.rerender(frameElement());
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
					instance.rerender(frameElement());
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

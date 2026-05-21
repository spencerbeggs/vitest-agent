/**
 * Hand-rolled Braille spinner for the `stream` live renderer.
 *
 * No `ink-spinner` dependency — that package is a thin wrapper over the
 * same ten Braille characters plus a timer. The `stream` renderer
 * already needs a frame clock for the ticking elapsed column, so the
 * timer is shared and only the frame array lives here.
 *
 * The frame index is presentation state: it is derived from wall-clock
 * time by `createLiveInk` and passed to `StreamApp` as a prop. It never
 * enters the event-sourced `RenderState`.
 *
 * @packageDocumentation
 */

/** The ten Braille spinner frames, in animation order. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** How long each spinner frame is held, in milliseconds. */
export const SPINNER_FRAME_MS = 80;

/**
 * Resolve the spinner glyph for a frame index. The index wraps modulo
 * the frame count and tolerates negative values, so a wall-clock-derived
 * index is always valid.
 */
export const spinnerFrame = (index: number): string => {
	const count = SPINNER_FRAMES.length;
	const wrapped = ((Math.trunc(index) % count) + count) % count;
	return SPINNER_FRAMES[wrapped];
};

/**
 * Derive the spinner frame index from a wall-clock timestamp. Using the
 * clock — rather than a monotonic counter — keeps the animation correct
 * across watch-mode remounts with no extra closure state to reset.
 */
export const spinnerFrameForTime = (nowMs: number): number => Math.floor(nowMs / SPINNER_FRAME_MS);

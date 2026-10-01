/**
 * Spinner frames for the `stream` live renderer, drawn from
 * `@effected/cli`'s glyph sets (the Braille frames in `Glyphs.unicode`,
 * a plain-ASCII fallback in `Glyphs.ascii`).
 *
 * No `ink-spinner` dependency. The `stream` renderer already needs a
 * frame clock for the ticking elapsed column, so the timer is shared and
 * only the frame lookup lives here.
 *
 * The frame index is presentation state: it is the kit live view's
 * `frame` (wall-clock ticks of `SPINNER_FRAME_MS`), passed to `StreamApp` as a prop. It never
 * enters the event-sourced `RenderState`.
 */

import type { GlyphSet } from "@effected/cli";
import { Glyphs } from "@effected/cli";

/**
 * The Unicode spinner frames, in animation order (`Glyphs.unicode.spinner`).
 *
 * @public
 */
export const SPINNER_FRAMES: ReadonlyArray<string> = Glyphs.unicode.spinner;

/**
 * How long each spinner frame is held, in milliseconds
 * (`Glyphs.unicode.spinnerIntervalMs`).
 *
 * @public
 */
export const SPINNER_FRAME_MS: number = Glyphs.unicode.spinnerIntervalMs;

/**
 * Resolve the spinner glyph for a frame index. The index wraps modulo
 * the frame count and tolerates negative values, so a wall-clock-derived
 * index is always valid.
 *
 * @param index - the frame index (wraps modulo frame count)
 * @param glyphs - the glyph set whose frames to draw; Unicode by default
 * @returns the spinner glyph for the given frame
 * @public
 */
export const spinnerFrame = (index: number, glyphs: GlyphSet = Glyphs.unicode): string => {
	const frames = glyphs.spinner;
	const count = frames.length;
	const wrapped = ((Math.trunc(index) % count) + count) % count;
	return frames[wrapped] ?? "";
};

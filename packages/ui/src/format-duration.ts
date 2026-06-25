/**
 * Shared display formatter for run / module / test durations.
 *
 * Vitest hands the reporter full-float millisecond durations
 * (`14.87745800000016`). Rendering those verbatim is noise. This is
 * the single formatter every render path calls — `render-agent.ts`,
 * the `render-ink/` components, the dispatcher cells, and `StreamApp`
 * — so a duration looks the same wherever it appears.
 *
 * Display only. Full-precision durations continue to persist to the
 * database unchanged; nothing in the trend / baseline / classification
 * pipeline reads a duration through a formatter.
 */

const SECOND_MS = 1000;

/**
 * Format a duration in milliseconds for display.
 *
 * Sub-second values round to one decimal place and render as `<N.N>ms`;
 * values at or above one second render as `<N.N>s`. A value that rounds
 * to a whole number drops the trailing `.0` naturally (`Number`
 * stringification), so `1000` → `1s` and `250` → `250ms`.
 *
 * @param ms - duration in milliseconds
 * @returns formatted duration string
 * @public
 */
export const formatDisplayDuration = (ms: number): string => {
	if (ms < SECOND_MS) {
		return `${Math.round(ms * 10) / 10}ms`;
	}
	return `${Math.round((ms / SECOND_MS) * 10) / 10}s`;
};

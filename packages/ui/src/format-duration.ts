/**
 * Shared display formatter for run / module / test durations.
 *
 * Vitest hands the reporter full-float millisecond durations
 * (`14.87745800000016`). Rendering those verbatim is noise. This is
 * the single formatter every render path calls — `render-agent.ts`,
 * the `render-ink/` components, the dispatcher cells, and `StreamApp`
 * — so a duration looks the same wherever it appears. It delegates to
 * `@effected/cli`'s `Fmt.duration`, so it also matches every other kit
 * CLI's output.
 *
 * Display only. Full-precision durations continue to persist to the
 * database unchanged; nothing in the trend / baseline / classification
 * pipeline reads a duration through a formatter.
 */

import { Fmt } from "@effected/cli";

/**
 * Format a duration in milliseconds for display.
 *
 * Whole milliseconds under a second (`250ms`), seconds to one decimal
 * under a minute with a trailing `.0` dropped (`1.2s`, `2s`), then
 * `1m 3s` and `1h 2m`. A value that rounds up to the next unit is
 * written in that unit (`999.6` → `1s`).
 *
 * @param ms - duration in milliseconds
 * @returns formatted duration string
 * @public
 */
export const formatDisplayDuration = (ms: number): string => Fmt.duration(ms);

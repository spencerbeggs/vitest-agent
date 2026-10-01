/**
 * Single-character status glyph for tests, modules, and the run itself.
 *
 * Ink-only primitive — no DOM-isms. Renders one colored character so
 * the surrounding row can keep its width budget predictable.
 */

import { Text } from "ink";
import type { FC } from "react";
import type { VitestAgentStatusName } from "../theme.js";
import { statusGlyph, statusInkStyle } from "../theme.js";
import { useGlyphs } from "./glyphs.js";

/**
 * The set of named statuses a `StatusIcon` can render.
 *
 * @public
 */
export type StatusIconKind =
	| "passed"
	| "failed"
	| "skipped"
	| "pending"
	| "running"
	| "queued"
	| "finished"
	| "threshold"
	| "timed-out";

/**
 * Props for the `StatusIcon` component.
 *
 * @public
 */
export interface StatusIconProps {
	/** The status to render as a colored glyph. */
	readonly status: StatusIconKind;
}

/**
 * Each icon kind's status in the shared vocabulary. `finished` is a pass;
 * `threshold` is a coverage threshold failure, which the kit ranks as a
 * `failure`, not a warning.
 */
const STATUS: Record<StatusIconKind, VitestAgentStatusName> = {
	passed: "success",
	failed: "failure",
	skipped: "skip",
	pending: "pending",
	running: "running",
	queued: "queued",
	finished: "success",
	threshold: "failure",
	"timed-out": "timeout",
};

/**
 * Renders a single colored status glyph for a test, module, or run.
 *
 * @public
 */
export const StatusIcon: FC<StatusIconProps> = ({ status }) => {
	const glyphs = useGlyphs();
	return <Text {...statusInkStyle(STATUS[status])}>{statusGlyph(STATUS[status], glyphs)}</Text>;
};

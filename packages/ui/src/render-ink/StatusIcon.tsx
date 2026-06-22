/**
 * Single-character status glyph for tests, modules, and the run itself.
 *
 * Ink-only primitive — no DOM-isms. Renders one colored character so
 * the surrounding row can keep its width budget predictable.
 */

import { Text } from "ink";
import type { FC } from "react";

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

const GLYPH: Record<StatusIconKind, string> = {
	passed: "✓",
	failed: "✗",
	skipped: "↷",
	pending: "◯",
	running: "…",
	queued: "·",
	finished: "✓",
	threshold: "⚠",
	"timed-out": "⧖",
};

const COLOR: Record<StatusIconKind, string> = {
	passed: "green",
	failed: "red",
	skipped: "gray",
	pending: "cyan",
	running: "yellow",
	queued: "gray",
	finished: "green",
	threshold: "yellow",
	"timed-out": "#e09a4e",
};

/**
 * Renders a single colored status glyph for a test, module, or run.
 *
 * @public
 */
export const StatusIcon: FC<StatusIconProps> = ({ status }) => <Text color={COLOR[status]}>{GLYPH[status]}</Text>;

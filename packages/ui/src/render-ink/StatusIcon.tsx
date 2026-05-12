/**
 * Single-character status glyph for tests, modules, and the run itself.
 *
 * Ink-only primitive — no DOM-isms. Renders one colored character so
 * the surrounding row can keep its width budget predictable.
 *
 * @packageDocumentation
 */

import { Text } from "ink";
import type { FC } from "react";
import * as React from "react";

export type StatusIconKind = "passed" | "failed" | "skipped" | "pending" | "running" | "queued" | "finished";

export interface StatusIconProps {
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
};

const COLOR: Record<StatusIconKind, string> = {
	passed: "green",
	failed: "red",
	skipped: "gray",
	pending: "cyan",
	running: "yellow",
	queued: "gray",
	finished: "green",
};

export const StatusIcon: FC<StatusIconProps> = ({ status }) => <Text color={COLOR[status]}>{GLYPH[status]}</Text>;

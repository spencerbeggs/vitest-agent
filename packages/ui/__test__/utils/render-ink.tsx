/**
 * Test helpers for the Ink renderer suite.
 *
 * ink-testing-library reports a fixed 100-column mock stdout. To make
 * width-sensitive snapshots reproducible we wrap the tree in a
 * `<Box width=N>` parent and strip ANSI escape sequences so the
 * snapshot file holds the visible text only.
 */

import { Box } from "ink";
import { render as inkRender } from "ink-testing-library";
import type { ReactElement } from "react";

const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

export const stripAnsi = (input: string): string => input.replace(ANSI_PATTERN, "");

export interface RenderResult {
	readonly frame: string;
	readonly rawFrame: string;
	readonly cleanup: () => void;
}

export const renderInk = (tree: ReactElement, width?: number): RenderResult => {
	const wrapped = width !== undefined ? <Box width={width}>{tree}</Box> : tree;
	const instance = inkRender(wrapped);
	const rawFrame = instance.lastFrame() ?? "";
	return {
		frame: stripAnsi(rawFrame),
		rawFrame,
		cleanup: instance.cleanup,
	};
};

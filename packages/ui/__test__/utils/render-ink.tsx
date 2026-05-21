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
	readonly frames: ReadonlyArray<string>;
	/**
	 * Concatenated visible output across every committed frame — useful
	 * for asserting on content that landed in Ink's `<Static>` region
	 * (which Ink commits once into terminal scrollback and never
	 * re-emits in subsequent frames). The last live frame ({@link
	 * RenderResult.frame}) only shows live-region content.
	 */
	readonly fullOutput: string;
	readonly rerender: (tree: ReactElement) => void;
	readonly cleanup: () => void;
}

export const renderInk = (tree: ReactElement, width?: number): RenderResult => {
	const wrap = (node: ReactElement) => (width !== undefined ? <Box width={width}>{node}</Box> : node);
	const instance = inkRender(wrap(tree));
	return {
		get frame(): string {
			return stripAnsi(instance.lastFrame() ?? "");
		},
		get rawFrame(): string {
			return instance.lastFrame() ?? "";
		},
		get frames(): ReadonlyArray<string> {
			return instance.frames.map(stripAnsi);
		},
		get fullOutput(): string {
			return instance.frames.map(stripAnsi).join("\n");
		},
		rerender: (next: ReactElement) => {
			instance.rerender(wrap(next));
		},
		cleanup: instance.cleanup,
	};
};

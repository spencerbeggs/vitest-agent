/**
 * Test helpers for the Ink renderer suite.
 *
 * ink-testing-library reports a fixed 100-column mock stdout. To make
 * width-sensitive snapshots reproducible we wrap the tree in a
 * `<Box width=N>` parent and strip ANSI escape sequences so the
 * snapshot file holds the visible text only.
 *
 * Every tree is wrapped in the kit's `UiProvider` (the components read
 * glyphs through the kit's `useGlyphs()`), holding `CliUi.context`'s value
 * under a fixed test theme (`CliTheme.layerTest()`: Ink's chalk still gates
 * our raw colour props, see `forceInkColor`) and Unicode glyphs unless a test asks for
 * ASCII.
 */

import type { GlyphSet } from "@effected/cli";
import { CliTheme } from "@effected/cli";
import type { UiContextValue } from "@effected/cli/ui";
import { CliUi, UiProvider } from "@effected/cli/ui";
import { Effect } from "effect";
import { Box } from "ink";
import { render as inkRender } from "ink-testing-library";
import type { ReactElement } from "react";

const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/**
 * The kit's context for trees the tests mount themselves. `CliUi.context`
 * loads Ink and React on first use (an async import), so it is resolved
 * once, at module load.
 */
export const uiContext: UiContextValue = await Effect.runPromise(
	CliUi.context.pipe(Effect.provide(CliTheme.layerTest())),
);

/** Options for {@link renderInk}. */
export interface RenderInkOptions {
	/** The glyph set the tree draws with; the kit's Unicode set by default. */
	readonly glyphs?: GlyphSet;
}

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

export const renderInk = (tree: ReactElement, width?: number, options: RenderInkOptions = {}): RenderResult => {
	const value: UiContextValue = options.glyphs === undefined ? uiContext : { ...uiContext, glyphs: options.glyphs };
	const wrap = (node: ReactElement) => (
		<UiProvider value={value}>{width !== undefined ? <Box width={width}>{node}</Box> : node}</UiProvider>
	);
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

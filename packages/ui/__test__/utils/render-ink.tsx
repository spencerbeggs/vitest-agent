/**
 * Test helper for the Ink renderer suite, over `@effected/cli-kit/ui/testing`'s
 * `CliUiTest.view`: the tree mounts inside the kit's providers (theme,
 * glyphs, `UiProvider`) on an in-memory terminal, and every frame is read
 * once the element has drawn. The harness unmounts when its scope closes,
 * so a result is plain data with nothing left to clean up.
 *
 * Width-sensitive output is pinned by the terminal's `columns`: 100 by
 * default, the width ink-testing-library's mock stdout reported, so line
 * wrapping matches the frames the snapshots were first taken at.
 */

import { CliUiTest } from "@effected/cli-kit/ui/testing";
import { Effect } from "effect";
import type { ReactElement } from "react";

/** The terminal width a tree lays out at when a test names none. */
export const DEFAULT_COLUMNS = 100;

/** Options for {@link renderInk}. */
export interface RenderInkOptions {
	/** The glyph set the tree draws with; the kit's Unicode set by default. */
	readonly glyphs?: "unicode" | "ascii";
	/**
	 * The terminal's colour level; `"none"` by default, so frames are
	 * escape-free. The colour pins pass `"truecolor"`, the only level that
	 * keeps colours apart.
	 */
	readonly color?: "none" | "truecolor";
}

export interface RenderResult {
	/** The last frame as plain text, each line's trailing spaces trimmed. */
	readonly frame: string;
	/** The last frame as Ink wrote it, escapes included (none under `color: "none"`). */
	readonly rawFrame: string;
	/** The last frame as `CliUiTest.styled` markup: a token is `[failure]x[/failure]`. */
	readonly styled: string;
}

/** Mount `tree` at `width` columns, read its frames, and unmount it. */
export const renderInk = (
	tree: ReactElement,
	width: number = DEFAULT_COLUMNS,
	options: RenderInkOptions = {},
): Promise<RenderResult> =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const view = yield* CliUiTest.view(tree, {
					columns: width,
					color: options.color ?? "none",
					...(options.glyphs !== undefined && { glyphs: options.glyphs }),
				});
				const frame = yield* view.plainFrame;
				const rawFrame = yield* view.rawFrame;
				const styled = yield* view.frame;
				return { frame, rawFrame, styled };
			}),
		),
	);

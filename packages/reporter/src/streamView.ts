/**
 * The `stream` live view's drawing: the reduced `RenderState` as
 * `StreamApp`, at the kit's frame index, inside a `FileLinkProvider` so
 * the module rows and failure paths are drawn through the link writer the
 * environment decided (issue #541).
 *
 * Loaded only through `CliUi.lazyView` in `liveView.ts`, so React and Ink
 * load when a run first mounts its Ink frame, never on an agent, CI or
 * piped run (which prints the `final` document instead). One of the two
 * sanctioned lazy-loaded modules in this package (with `humanReport.ts`):
 * nothing else here may import `ink`, `react` or `@vitest-agent/ui/ink`.
 * It must not import `liveView.ts`, which holds the dynamic import, or
 * Biome's `noImportCycles` reports the cycle.
 *
 * @internal
 */

import type { RenderState } from "@vitest-agent/sdk";
import { SPINNER_FRAME_MS } from "@vitest-agent/ui";
import { FileLinkProvider, StreamApp } from "@vitest-agent/ui/ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { FileLink } from "./fileLinks.js";

/**
 * The view for one live view, closed over its link writer.
 *
 * @internal
 */
export const makeStreamView =
	(link: FileLink) =>
	(state: RenderState, frame: number): ReactElement =>
		createElement(
			FileLinkProvider,
			{ link },
			createElement(StreamApp, { state, frameIndex: frame, nowMs: frame * SPINNER_FRAME_MS }),
		);

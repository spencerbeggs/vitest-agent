/**
 * The `stream` live view's drawing: the reduced `RenderState` as
 * `StreamApp`, at the kit's frame index.
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
import { StreamApp } from "@vitest-agent/ui/ink";
import type { ReactElement } from "react";
import { createElement } from "react";

const streamView = (state: RenderState, frame: number): ReactElement =>
	createElement(StreamApp, { state, frameIndex: frame, nowMs: frame * SPINNER_FRAME_MS });

export default streamView;

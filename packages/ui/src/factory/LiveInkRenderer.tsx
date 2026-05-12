/**
 * Imperative live-mount Ink renderer driven by streaming
 * {@link RunEvent}s. Holds its own reducer state and Ink mount handle
 * across the lifetime of a test run.
 *
 * Mount happens on the first `RunStarted` event so the renderer
 * doesn't compete with Vitest's stdout setup. Each subsequent event
 * folds the state forward and rerenders the Ink tree. The final
 * `RunFinished` event triggers an `unmount` on the next tick — far
 * enough away that the terminal commits the final frame before Ink
 * tears down its alt-screen handling.
 *
 * After teardown, the internal scheduling flag is reset so the same
 * handle can drive subsequent runs (long-lived dev processes, watch
 * mode). The reducer's `state` is intentionally preserved across run
 * boundaries — a fresh `RunStarted` resets it via the reducer.
 *
 * @packageDocumentation
 */

import { render as inkRender } from "ink";
import { createElement } from "react";
import type { RenderState, RunEvent } from "vitest-agent-sdk";
import { initialRenderState } from "vitest-agent-sdk";
import { reduceRenderState } from "../reducer.js";
import type { AppOptions } from "../render-ink/App.js";
import { App } from "../render-ink/App.js";

export interface CreateLiveInkOptions {
	/** Initial width hint for the Ink tree. Defaults to terminal columns. */
	readonly width?: number;
	/** Options threaded to the root {@link App} component. */
	readonly app?: AppOptions;
	/**
	 * Override the stream Ink writes to. Defaults to `process.stdout`.
	 * Tests pass a captured Writable here to assert on rendered frames.
	 */
	readonly stream?: NodeJS.WriteStream;
}

export interface LiveInkRenderer {
	/**
	 * Process a {@link RunEvent}. Mounts the Ink tree on `RunStarted`,
	 * rerenders on every event that mutates state, schedules a clean
	 * unmount on `RunFinished`.
	 */
	readonly event: (event: RunEvent) => void;
	/**
	 * Force an immediate unmount. Safe to call multiple times. Useful in
	 * tests or when the host needs to tear down out of band (e.g. a
	 * cancellation signal).
	 */
	readonly unmount: () => void;
	/**
	 * Latest reduced state. Exposed for hosts that want to assert on the
	 * accumulated value at any point during the run.
	 */
	readonly snapshot: () => RenderState;
}

type InkInstance = ReturnType<typeof inkRender>;

export const createLiveInk = (options: CreateLiveInkOptions = {}): LiveInkRenderer => {
	let state: RenderState = initialRenderState;
	let instance: InkInstance | null = null;
	let unmountScheduled = false;

	const renderTree = () => createElement(App, { state, options: options.app ?? {} });

	const mount = () => {
		if (instance !== null) return;
		const renderOptions: Parameters<typeof inkRender>[1] = {};
		if (options.stream !== undefined) {
			renderOptions.stdout = options.stream;
		}
		instance = inkRender(renderTree(), renderOptions);
	};

	const tearDown = () => {
		if (instance === null) return;
		instance.unmount();
		instance = null;
	};

	return {
		event(event: RunEvent): void {
			const previousPhase = state.phase;
			state = reduceRenderState(state, event);

			// Mount and rerender are wrapped because Ink's mount can throw
			// in non-TTY environments (Vitest's stdout shim, piped output).
			// The orchestration must keep advancing state regardless — hosts
			// rely on `snapshot()` even when the visible mount silently
			// degrades.
			try {
				if (event._tag === "RunStarted" || (previousPhase === "idle" && state.phase !== "idle")) {
					mount();
				} else if (instance !== null) {
					instance.rerender(renderTree());
				}
			} catch (err) {
				process.stderr.write(
					`vitest-agent-ui: live ink renderer failed; falling back silently (${(err as Error).message})\n`,
				);
				instance = null;
			}

			if (event._tag === "RunFinished" && !unmountScheduled) {
				unmountScheduled = true;
				// Defer to next tick so Ink commits the final frame before
				// tearing down the alt-screen / cursor management. Without
				// this, the bottom of the tree can disappear before the
				// shell sees it on slow terminals.
				setImmediate(() => {
					tearDown();
					// Reset state-machine flags so the same handle can drive a
					// subsequent run (long-lived dev process, watch mode). The
					// reducer's `state` is intentionally preserved so the next
					// `RunStarted` event sees the previous `phase: "finished"`
					// transition correctly.
					unmountScheduled = false;
				});
			}
		},
		unmount(): void {
			tearDown();
		},
		snapshot(): RenderState {
			return state;
		},
	};
};

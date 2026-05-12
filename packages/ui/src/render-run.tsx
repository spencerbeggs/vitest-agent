/**
 * Synchronous one-shot renderer for a fully-reduced run.
 *
 * This is the integration entry point hosts call once at end-of-run
 * to produce the final-frame string. The two modes both return a
 * string — what differs is the layout. Agent mode runs the
 * markdown-flavored renderer tuned for token economy. Human mode
 * renders the Ink tree via `renderToString`, which keeps the
 * boxes/colors/wrapping a live terminal would show but with no
 * mount, no signal handlers, no reconciler lifetime to manage.
 *
 * Callers that want a live human-mode view (Ink re-rendering as
 * events arrive) use the PubSub subscription path instead.
 *
 * @packageDocumentation
 */

import { renderToString } from "ink";
import { createElement } from "react";
import type { RenderState, RunEvent } from "vitest-agent-sdk";
import { reduceRenderStateAll } from "./reducer.js";
import type { RenderAgentOptions } from "./render-agent.js";
import { renderAgent } from "./render-agent.js";
import type { AppOptions } from "./render-ink/App.js";
import { App } from "./render-ink/App.js";

export type RenderRunMode = "agent" | "human";

export interface RenderRunOptions {
	/**
	 * Width hint passed to the underlying renderer. Agent mode uses
	 * it for diff truncation and gap-listing budgets; human mode
	 * passes it directly to Ink's renderToString so the box layout
	 * is reproducible regardless of the runtime terminal width.
	 *
	 * @defaultValue 80
	 */
	readonly width?: number;
	/** Agent-mode renderer options. Ignored in human mode. */
	readonly agent?: RenderAgentOptions;
	/** Human-mode (Ink) App options. Ignored in agent mode. */
	readonly human?: AppOptions;
}

const DEFAULT_WIDTH = 80;

/**
 * Project an already-reduced state into the chosen mode's string output.
 */
export const renderRunFromState = (state: RenderState, mode: RenderRunMode, options: RenderRunOptions = {}): string => {
	const width = options.width ?? DEFAULT_WIDTH;
	if (mode === "agent") {
		return renderAgent(state, { ...options.agent, width });
	}
	return renderToString(createElement(App, { state, options: options.human ?? {} }), {
		columns: width,
	});
};

/**
 * One-shot pipeline: fold the supplied events through the reducer and
 * produce a string for the chosen mode. The function is deterministic
 * — calling it twice with identical inputs returns the same string.
 */
export const renderRun = (
	events: ReadonlyArray<RunEvent>,
	mode: RenderRunMode,
	options: RenderRunOptions = {},
): string => renderRunFromState(reduceRenderStateAll(events), mode, options);

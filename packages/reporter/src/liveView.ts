/**
 * The `stream` console mode's live view: the plugin's run-event channel
 * folded through `reduceRenderState` and drawn as `StreamApp` by the
 * kit's `CliUi.live`.
 *
 * The drawing lives in `streamView.ts`, loaded through `CliUi.lazyView`, so
 * this module (and everything that imports it) loads neither React nor Ink:
 * the view module loads only when a run first mounts its Ink frame, and an
 * agent, CI or piped run, which prints the `final` document instead, never
 * loads it.
 *
 * The kit owns the mount: a run mounts at `RunStarted` (or where `begins`
 * says), redraws on every event and on an 80 ms tick, and commits its final
 * frame to scrollback at the terminal event (`RunFinished` /
 * `RunTimedOut`), never clearing the screen. The next run in watch mode
 * mounts afresh below it. When the run is not interactive (piped, CI) nothing
 * is mounted: each run's `final` document is written once to stdout instead,
 * so a `vitest run | cat` still receives the result. That document is the
 * plain report `renderAgent` builds from the same state (header, failures,
 * modules, coverage, suggested actions), each line kept whole; it does not
 * try to reproduce the Ink frame, and drawing it never renders through Ink.
 *
 * Lifetime: the kit's `CliUi.liveDetached` runs the view outside Effect for
 * the reporter's whole life. It subscribes to the channel synchronously,
 * before the factory returns, so the first `RunStarted` is never lost. At
 * Vitest's close the plugin calls the view's `close` before it shuts the
 * channel down: `close` folds every message still queued in the
 * subscription and commits the last run (so a tail published just before
 * the close is kept), then releases the view. The view never relies on
 * `PubSub.shutdown` to end it: shutdown drops whatever a subscriber has not
 * taken yet. It is never closed at `onTestRunEnd`, which fires on every
 * watch rerun.
 */

import * as NodeServices from "@effect/platform-node/NodeServices";
import type { CliLinks, CliTheme } from "@effected/cli";
import { CliEnv, Doc } from "@effected/cli";
import type { DetachedLive, LiveOptions } from "@effected/cli/ui";
import { CliUi } from "@effected/cli/ui";
import type { Audience, TerminalEnv } from "@effected/env";
import type { RenderState, RunEvent } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { SPINNER_FRAME_MS, reduceRenderState, renderAgent } from "@vitest-agent/ui";
import type { PubSub } from "effect";
import { Cause, Effect, Exit, Layer } from "effect";
import type { FileLink } from "./fileLinks.js";
import { plainFileLink, resolveFileLink } from "./fileLinks.js";

/**
 * The Ink frame's draw function for a view whose paths are drawn through
 * `link`. The one sanctioned dynamic import outside mcp's `main.ts` (with
 * `humanReport.ts`'s): React and Ink load only when a run draws. The view
 * module exports a factory, so the writer reaches the tree without this
 * module importing React.
 */
const streamRender = (link: FileLink): LiveOptions<RunEvent, RenderState>["render"] =>
	CliUi.lazyView(() => import("./streamView.js").then((view) => view.makeStreamView(link)));

/**
 * The live view's options, everything but `events`, for a view whose paths
 * are drawn through `link`.
 *
 * @internal
 */
export const liveViewOptionsWith = (link: FileLink): Omit<LiveOptions<RunEvent, RenderState>, "events"> => ({
	initial: initialRenderState,
	reduce: reduceRenderState,
	render: streamRender(link),
	isStart: (event) => event._tag === "RunStarted",
	isTerminal: (event) => event._tag === "RunFinished" || event._tag === "RunTimedOut",
	// Join a run already under way (the first event folds the state out of
	// idle) as well as a fresh `RunStarted`. Events published after
	// `RunFinished` (`CoverageReady`, `ThresholdViolation`, `TrendComputed`,
	// `WatcherReady`) leave the phase where it is, so they never begin a run
	// and never commit a second copy of the final frame.
	begins: (event, before, after) => event._tag === "RunStarted" || (before.phase === "idle" && after.phase !== "idle"),
	// `owned`, not `hosted`: a non-interactive run must still print its final
	// frame, since `stream` mode emits nothing from `render`.
	mode: "owned",
	tickMillis: SPINNER_FRAME_MS,
	// What a non-interactive run prints, once per run, in place of the Ink
	// frame: the plain report, one unwrapped line per report line.
	final: (state) =>
		renderAgent(state)
			.trimEnd()
			.split("\n")
			.map((line) => Doc.line(line, { wrap: false })),
});

/**
 * The live view's options with no link writer (every path its label alone):
 * what the tests hand `CliUiTest.live`, so they run the same fold, drawing
 * and run predicates `startLiveView` does.
 *
 * @internal
 */
export const liveViewOptions: Omit<LiveOptions<RunEvent, RenderState>, "events"> = liveViewOptionsWith(plainFileLink);

/**
 * The environment a Vitest-hosted live view reads: the kit's `CliEnv` over
 * Node's stdio and terminal. It builds `CliTheme` (colour from the terminal,
 * glyphs `auto`, so `TERM=dumb` draws ASCII), `TerminalEnv` (the width the
 * report-time human render lays out at, and whether stdout renders OSC 8),
 * `Audience` and `CliLinks` (where a file link opens; the platform is
 * provided outside `CliEnv.layer`, so a `.vscode/` directory is looked for
 * and a relative path resolved against the working directory), and sets
 * `CliInteractive` (a human audience with a TTY on stdin and stdout).
 *
 * @internal
 */
export const LiveViewEnv: Layer.Layer<CliTheme | TerminalEnv | Audience | CliLinks> = CliEnv.layer().pipe(
	Layer.provide(NodeServices.layer),
);

/**
 * Start a live view over `channel` with the kit's `CliUi.liveDetached`. The
 * subscription is taken before this returns, so an event published right
 * after is seen.
 *
 * The returned view's `printAbove` is the reporter's `printStrayLine`: it
 * prints the line above the frame and answers `true` only while a run's
 * frame is mounted, declining (`false`, nothing written) before the view is
 * up, between runs, when the view is not interactive (it never mounts), and
 * once `close` has been called, so the plugin writes the line itself.
 * `close` is idempotent and never rejects; a view that died of anything but
 * an interrupt is logged as a warning.
 *
 * @param channel - the plugin's run-event channel
 * @param env - the environment the view reads; {@link LiveViewEnv} by default (a test
 *   merges `UiStreams` / `CliInteractive` into a fixed theme instead)
 *
 * @internal
 */
export const startLiveView = (
	channel: PubSub.PubSub<RunEvent>,
	env: Layer.Layer<CliTheme> = LiveViewEnv,
): DetachedLive<RenderState> => {
	// The link writer comes from the environment the view runs under, resolved
	// once under `env` itself; a theme-only test environment resolves to the
	// label alone. It never fails.
	const view = CliUi.liveDetached(
		{ ...liveViewOptions, render: Effect.map(resolveFileLink, streamRender), events: channel },
		env,
	);
	void view.exit.then((exit) => {
		if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
			Effect.runFork(Effect.logWarning("vitest-agent: the live view ended with an error", exit.cause));
		}
	});
	return view;
};

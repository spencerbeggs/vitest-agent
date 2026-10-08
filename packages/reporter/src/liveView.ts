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
 * Lifetime: one scope per live view, held for the reporter's whole life. The
 * subscription is made in it synchronously, before the factory returns, so
 * the first `RunStarted` is never lost, and the view takes from it directly
 * (`events: subscription`). At Vitest's close the plugin calls
 * {@link LiveRunView.close} before it shuts the channel down: close runs the
 * kit's `LiveHandle.close` (it folds every message still queued in the
 * subscription and commits the last run, so a tail published just before the
 * close is kept), then closes the scope. The view never relies on
 * `PubSub.shutdown` to end it: shutdown drops whatever a subscriber has not
 * taken yet. It is never closed at `onTestRunEnd`, which fires on every
 * watch rerun.
 */

import * as NodeServices from "@effect/platform-node/NodeServices";
import type { CliTheme } from "@effected/cli";
import { CliEnv, Doc } from "@effected/cli";
import type { LiveHandle, LiveOptions } from "@effected/cli/ui";
import { CliUi } from "@effected/cli/ui";
import type { TerminalEnv } from "@effected/env";
import type { RenderState, RunEvent } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { SPINNER_FRAME_MS, reduceRenderState, renderAgent } from "@vitest-agent/ui";
import { Cause, Deferred, Effect, Exit, Layer, PubSub, Scope } from "effect";

/**
 * The live view's options, everything but `events`: what the reporter hands
 * `CliUi.live`, and what the tests hand `CliUiTest.live`, so both run the
 * same fold, drawing and run predicates.
 *
 * @internal
 */
export const liveViewOptions: Omit<LiveOptions<RunEvent, RenderState>, "events"> = {
	initial: initialRenderState,
	reduce: reduceRenderState,
	// The one sanctioned dynamic import outside mcp's `main.ts` (with
	// `humanReport.ts`'s): React and Ink load only when a run draws.
	render: CliUi.lazyView(() => import("./streamView.js")),
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
};

/**
 * The environment a Vitest-hosted live view reads: the kit's `CliEnv` over
 * Node's stdio and terminal. It builds `CliTheme` (colour from the terminal,
 * glyphs `auto`, so `TERM=dumb` draws ASCII) and `TerminalEnv` (the width
 * the report-time human render lays out at), and sets `CliInteractive` (a
 * human audience with a TTY on stdin and stdout).
 *
 * @internal
 */
export const LiveViewEnv: Layer.Layer<CliTheme | TerminalEnv> = CliEnv.layer().pipe(Layer.provide(NodeServices.layer));

/**
 * Print one line of stray output (bytes a test process wrote straight to the
 * terminal) through the view's `logConsole`: above the frame while a run is
 * drawn, straight to the stream otherwise, so it never lands under the frame
 * where the next redraw would strand it.
 *
 * @internal
 */
export const printAbove =
	(handle: LiveHandle<RenderState>) =>
	(stream: "stdout" | "stderr", line: string): true => {
		if (stream === "stderr") handle.logConsole.error(line);
		else handle.logConsole.log(line);
		return true;
	};

/**
 * A live view bound to a run-event channel for the reporter's lifetime.
 *
 * @internal
 */
export interface LiveRunView {
	/**
	 * The view's handle, once `CliUi.live` has mounted it (it loads Ink
	 * asynchronously): its state, its `logConsole`, and `done`.
	 */
	readonly handle: Promise<LiveHandle<RenderState>>;
	/**
	 * End the view: the kit's `LiveHandle.close` folds every event still queued
	 * in the subscription and commits the last run, then the scope is closed.
	 * Call it before the channel is shut down. Idempotent; never rejects (a
	 * view that died is logged as a warning).
	 */
	readonly close: () => Promise<void>;
	/**
	 * The reporter's `printStrayLine`: print a stray line through the view
	 * ({@link printAbove}). Declines (`false`) until the handle is up and once
	 * `close` has been called, so the plugin writes the line itself.
	 */
	readonly printStrayLine: (stream: "stdout" | "stderr", line: string) => boolean;
}

/**
 * Start a live view over `channel`. The subscription is taken before this
 * returns, so an event published right after is seen.
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
): LiveRunView => {
	const scope = Effect.runSync(Scope.make());
	const subscription = Effect.runSync(PubSub.subscribe(channel).pipe(Scope.provide(scope)));
	const mounted = Effect.runSync(Deferred.make<LiveHandle<RenderState>>());
	const program = CliUi.live({ ...liveViewOptions, events: subscription }).pipe(
		// A mount that dies settles `mounted` too, so `close` never waits on it.
		Effect.onExit((exit) => Deferred.done(mounted, exit)),
		Effect.flatMap((handle) => handle.done),
		Scope.provide(scope),
		Effect.provide(env),
	);
	Effect.runFork(program);
	let closing: Promise<void> | undefined;
	let print: ((stream: "stdout" | "stderr", line: string) => boolean) | undefined;
	const handle = Effect.runPromise(Deferred.await(mounted));
	handle.then(
		(mountedHandle) => {
			if (closing === undefined) print = printAbove(mountedHandle);
		},
		() => undefined,
	);
	return {
		handle,
		printStrayLine: (stream, line) => print?.(stream, line) ?? false,
		close: () => {
			print = undefined;
			closing ??= Effect.runPromise(
				Deferred.await(mounted).pipe(
					Effect.flatMap((handle) => handle.close),
					Effect.catchCause((cause) =>
						Cause.hasInterruptsOnly(cause)
							? Effect.void
							: Effect.logWarning("vitest-agent: the live view ended with an error", cause),
					),
					Effect.ensuring(Scope.close(scope, Exit.void)),
				),
			);
			return closing;
		},
	};
};

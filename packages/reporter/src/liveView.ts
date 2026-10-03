/**
 * The `stream` console mode's live view: the plugin's run-event channel
 * folded through `reduceRenderState` and drawn as {@link StreamApp} by the
 * kit's `CliUi.live`.
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
import type { RenderState, RunEvent } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { SPINNER_FRAME_MS, StreamApp, reduceRenderState, renderAgent } from "@vitest-agent/ui";
import { Cause, Deferred, Effect, Exit, Layer, PubSub, Scope } from "effect";
import { createElement } from "react";

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
	render: (state, frame) => createElement(StreamApp, { state, frameIndex: frame, nowMs: frame * SPINNER_FRAME_MS }),
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
 * glyphs `auto`, so `TERM=dumb` draws ASCII) and sets `CliInteractive` (a
 * human audience with a TTY on stdin and stdout).
 *
 * @internal
 */
export const LiveViewEnv: Layer.Layer<CliTheme> = CliEnv.layer().pipe(Layer.provide(NodeServices.layer));

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
	return {
		handle: Effect.runPromise(Deferred.await(mounted)),
		close: () => {
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

/**
 * The `stream` console mode's live view: the plugin's run-event channel
 * folded through `reduceRenderState` and drawn as {@link StreamApp} by the
 * kit's `CliUi.live`.
 *
 * The kit owns the mount: a run mounts at `RunStarted` (or where `begins`
 * says), redraws on every event and on an 80 ms tick, and commits its final
 * frame to scrollback at the terminal event (`RunFinished` /
 * `RunTimedOut`), never clearing the screen. The next run in watch mode
 * mounts afresh below it. When the run is not interactive (piped, an agent
 * audience, CI) nothing is mounted and, in the `owned` mode, each run's final
 * frame is written once to stdout as a string, so a `vitest run | cat` still
 * receives the result.
 *
 * Lifetime: one scope per live view, held for the reporter's whole life. The
 * subscription is made in it synchronously, before the factory returns, so
 * the first `RunStarted` is never lost. At Vitest's close the plugin calls
 * {@link LiveRunView.close} before it shuts the channel down: close waits
 * until the view has pulled everything published to its subscription, ends
 * the view's own stream, waits for `done` (the last run committed) and closes
 * the scope. The view never relies on `PubSub.shutdown` to end its stream:
 * shutdown drops whatever a subscriber has not pulled yet (probed on
 * effect 4.0.0-rc.118: publish 7, shutdown, `runCollect` gives `[]`). It is
 * never closed at `onTestRunEnd`, which fires on every watch rerun.
 */

import * as NodeServices from "@effect/platform-node/NodeServices";
import type { CliTheme } from "@effected/cli";
import { CliEnv } from "@effected/cli";
import type { LiveHandle, LiveOptions } from "@effected/cli/ui";
import { CliUi } from "@effected/cli/ui";
import type { RenderState, RunEvent } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { SPINNER_FRAME_MS, StreamApp, reduceRenderState } from "@vitest-agent/ui";
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, PubSub, Scope, Stream } from "effect";
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
 * How long {@link LiveRunView.close} waits for the view to commit its last
 * run once the channel has ended, before closing the scope regardless.
 */
const CLOSE_GRACE = Duration.seconds(2);

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
	 * End the view: wait until it has pulled everything published so far, end
	 * its stream, wait for it to commit its last run (each wait bounded by a
	 * short grace), then close the scope. Call it before the channel is shut
	 * down. Idempotent; never rejects.
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
	const stop = Effect.runSync(Deferred.make<void>());
	// `interruptWhen`, not `haltWhen`: the stop comes once the subscription
	// is drained, when the stream is parked in a pull that `haltWhen` would
	// wait out forever. Nothing is pending then, so nothing is cut.
	const events = Stream.fromSubscription(subscription).pipe(Stream.interruptWhen(Deferred.await(stop)));
	const program = CliUi.live({ ...liveViewOptions, events }).pipe(
		Effect.tap((handle) => Deferred.succeed(mounted, handle)),
		Effect.flatMap((handle) => handle.done),
		Scope.provide(scope),
		Effect.provide(env),
	);
	const fiber = Effect.runFork(program);
	let closing: Promise<void> | undefined;
	return {
		handle: Effect.runPromise(Deferred.await(mounted)),
		close: () => {
			// Drained: `remaining` is 0 once the view's pull has taken every
			// message (it interrupts if the channel was already shut down).
			const drained = Effect.gen(function* () {
				while ((yield* PubSub.remaining(subscription)) > 0) yield* Effect.sleep(Duration.millis(5));
			}).pipe(Effect.timeoutOption(CLOSE_GRACE), Effect.ignoreCause);
			closing ??= Effect.runPromise(
				drained.pipe(
					Effect.andThen(Deferred.succeed(stop, undefined)),
					Effect.andThen(Effect.timeoutOption(Fiber.await(fiber), CLOSE_GRACE)),
					Effect.flatMap((exit) =>
						exit._tag === "Some" && Exit.isFailure(exit.value) && !Cause.hasInterruptsOnly(exit.value.cause)
							? Effect.logWarning("vitest-agent: the live view ended with an error", exit.value.cause)
							: Effect.void,
					),
					Effect.ensuring(Scope.close(scope, Exit.void)),
				),
			);
			return closing;
		},
	};
};

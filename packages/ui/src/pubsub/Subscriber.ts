/**
 * Subscription patterns over the shared {@link RunEventChannel}.
 *
 * Two patterns are exposed:
 *
 * - {@link accumulateUntilFinished} drives the agent path. A single
 *   fiber drains the channel, folds events through the reducer, and
 *   returns the final {@link RenderState} when `RunFinished` arrives.
 *   The agent renderer then runs once on that terminal state.
 *
 * - {@link forEachRenderState} drives the Ink path. The reducer runs
 *   over the channel as a `Stream.scan`, emitting every new state to
 *   the supplied callback so the renderer can redraw.
 *
 * @packageDocumentation
 */

import type { RenderState, RunEvent } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { Effect, PubSub, Queue, Stream } from "effect";
import { reduceRenderState } from "../reducer.js";
import { RunEventChannel } from "./Channel.js";

/**
 * Subscribe, fold the run-event stream into a terminal
 * {@link RenderState}, and return when `RunFinished` arrives.
 *
 * The subscription is scoped — when this effect completes (or is
 * interrupted), the underlying PubSub releases its slot.
 */
export const accumulateUntilFinished = (
	initial: RenderState = initialRenderState,
): Effect.Effect<RenderState, never, RunEventChannel> =>
	Effect.scoped(
		Effect.gen(function* () {
			const channel = yield* RunEventChannel;
			const dequeue = yield* PubSub.subscribe(channel);
			let state = initial;
			// `finished` and `timed-out` are both terminal — a run that
			// timed out never emits `RunFinished`, so accumulating only
			// against `finished` would hang the agent path forever.
			while (state.phase !== "finished" && state.phase !== "timed-out") {
				const event = yield* Queue.take(dequeue);
				state = reduceRenderState(state, event);
			}
			return state;
		}),
	);

/**
 * Run a callback for every projected {@link RenderState} as events
 * arrive. The stream terminates when the PubSub shuts down (typically
 * when the surrounding scope closes).
 *
 * The host runs this in a forked fiber so the publisher and the
 * renderer can make progress concurrently. Returning an Effect from
 * the callback lets the host suspend further rendering on backpressure
 * (e.g. throttling redraws to the next animation frame).
 */
export const forEachRenderState = <R, E>(
	onState: (state: RenderState) => Effect.Effect<void, E, R>,
	initial: RenderState = initialRenderState,
): Effect.Effect<void, E, R | RunEventChannel> =>
	Effect.scoped(
		Effect.gen(function* () {
			const channel = yield* RunEventChannel;
			const stream = yield* Stream.fromPubSub(channel, { scoped: true });
			yield* stream.pipe(Stream.scan(initial, reduceRenderState), Stream.runForEach(onState));
		}),
	);

/**
 * Build a {@link Stream} of accumulated states over the channel.
 *
 * Lower-level than {@link forEachRenderState} — useful when the host
 * wants to compose with other stream operators (debouncing, throttling,
 * tee-to-file) before running the terminal sink.
 */
export const renderStateStream = (
	initial: RenderState = initialRenderState,
): Effect.Effect<Stream.Stream<RenderState>, never, RunEventChannel | import("effect").Scope.Scope> =>
	Effect.gen(function* () {
		const channel = yield* RunEventChannel;
		const stream = yield* Stream.fromPubSub(channel, { scoped: true });
		return stream.pipe(Stream.scan(initial, reduceRenderState));
	});

/**
 * Convenience: subscribe and produce a low-level dequeue of raw
 * {@link RunEvent} values. Mostly for tests and ad-hoc consumers; most
 * application code should prefer {@link forEachRenderState} or
 * {@link renderStateStream}.
 */
export const subscribeRaw = (): Effect.Effect<
	Queue.Dequeue<RunEvent>,
	never,
	RunEventChannel | import("effect").Scope.Scope
> =>
	Effect.gen(function* () {
		const channel = yield* RunEventChannel;
		return yield* PubSub.subscribe(channel);
	});

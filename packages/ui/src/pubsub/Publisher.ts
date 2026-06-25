/**
 * Helpers for emitting `RunEvent` values onto the shared
 * {@link RunEventChannel}.
 *
 * Hosts run these inside an Effect (typically via
 * `runtime.runPromise(...)`) from their callback-style entry points —
 * Vitest reporter callbacks for the plugin, CLI command bodies that
 * synthesize an event sequence from database queries.
 */

import type { RunEvent } from "@vitest-agent/sdk";
import { Effect, PubSub } from "effect";
import { RunEventChannel } from "./Channel.js";

/**
 * Emit one event onto the channel.
 *
 * Resolves when the event is enqueued. Returns the success boolean
 * from `PubSub.publish` so callers can detect a shutdown
 * channel if needed; in normal operation the result is always `true`.
 *
 * @param event - the run event to publish
 * @returns an Effect that resolves to the publish success boolean
 * @public
 */
export const publish = (event: RunEvent): Effect.Effect<boolean, never, RunEventChannel> =>
	Effect.gen(function* () {
		const channel = yield* RunEventChannel;
		return yield* PubSub.publish(channel, event);
	});

/**
 * Emit a batch of events onto the channel in order.
 *
 * Useful for the CLI replay path where the entire event sequence is
 * materialized synchronously from a database query before any
 * subscriber needs to read it.
 *
 * @param events - iterable of run events to publish in order
 * @returns an Effect that resolves when all events are enqueued
 * @public
 */
export const publishAll = (events: Iterable<RunEvent>): Effect.Effect<void, never, RunEventChannel> =>
	Effect.gen(function* () {
		const channel = yield* RunEventChannel;
		yield* PubSub.publishAll(channel, events);
	});

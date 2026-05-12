/**
 * Effect channel carrying the {@link RunEvent} stream between the
 * publisher (Vitest reporter callbacks, CLI replay constructors) and
 * the subscribers (Ink human-mode renderer, agent-mode accumulator,
 * future tee-to-file or live-mirror consumers).
 *
 * @packageDocumentation
 */

import { Context, Layer, PubSub } from "effect";
import type { RunEvent } from "vitest-agent-sdk";

/**
 * Service tag for the run-event channel. Consumers depend on this tag;
 * the {@link RunEventChannelLive} layer is the single point at which
 * the underlying {@link PubSub.PubSub} is constructed.
 */
export class RunEventChannel extends Context.Tag("vitest-agent-ui/RunEventChannel")<
	RunEventChannel,
	PubSub.PubSub<RunEvent>
>() {}

/**
 * Default live layer providing an unbounded {@link PubSub.PubSub} for
 * the run-event channel. The PubSub is scoped — when the surrounding
 * scope closes, the channel shuts down and any pending subscribers
 * receive their dequeue closure.
 *
 * Unbounded is the right default for the plugin and CLI: events arrive
 * faster than a slow renderer can drain (e.g., several `TestFinished`
 * per millisecond during a large suite), and dropping events would
 * leave the rendered state inconsistent with the runner's truth.
 * If memory pressure becomes a concern, swap in {@link PubSub.sliding}
 * with a tuned capacity at the call site.
 */
export const RunEventChannelLive: Layer.Layer<RunEventChannel> = Layer.scoped(
	RunEventChannel,
	PubSub.unbounded<RunEvent>(),
);

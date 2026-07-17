import type { RenderState, RunEvent } from "@vitest-agent/sdk";
import { Effect, Fiber, PubSub, Ref, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
	RunEventChannel,
	RunEventChannelLive,
	accumulateUntilFinished,
	publishAll,
	reduceRenderStateAll,
	renderStateStream,
} from "../src/index.js";
import { allPassEvents, coverageViolationEvents, flakyRecoveryEvents, mixedFailEvents } from "./utils/events.js";

/**
 * Helper: drive a publisher/consumer pair inside the live channel
 * layer. Subscribes BEFORE forking the publisher so no events are
 * missed.
 */
const runRoundtrip = (events: ReadonlyArray<RunEvent>): Promise<RenderState> =>
	Effect.scoped(
		Effect.gen(function* () {
			const fiber = yield* Effect.forkChild(accumulateUntilFinished());
			// Small synchronous yield to let the subscriber register before publish.
			yield* Effect.yieldNow;
			yield* publishAll(events);
			return yield* Fiber.join(fiber);
		}),
	).pipe(Effect.provide(RunEventChannelLive), Effect.runPromise);

describe("RunEventChannel — roundtrip", () => {
	it.each([
		["all-pass", allPassEvents],
		["mixed-fail", mixedFailEvents],
		["coverage-violation", coverageViolationEvents],
		["flaky-recovery", flakyRecoveryEvents],
	])("fixture %s round-trips through the channel into the same state as the synchronous fold", async (_, events) => {
		const viaChannel = await runRoundtrip(events);
		const viaSync = reduceRenderStateAll(events);
		expect(viaChannel).toEqual(viaSync);
	});
});

describe("RunEventChannel — multi-subscriber fan-out", () => {
	it("two independent subscribers each see every event", async () => {
		const subscribe = (): Effect.Effect<ReadonlyArray<RunEvent>, never, RunEventChannel> =>
			Effect.scoped(
				Effect.gen(function* () {
					const channel = yield* RunEventChannel;
					const dequeue = yield* PubSub.subscribe(channel);
					const received: RunEvent[] = [];
					let done = false;
					while (!done) {
						const event = yield* PubSub.take(dequeue);
						received.push(event);
						if (event._tag === "RunFinished") done = true;
					}
					return received;
				}),
			);

		const program = Effect.scoped(
			Effect.gen(function* () {
				const fiberA = yield* Effect.forkChild(subscribe());
				const fiberB = yield* Effect.forkChild(subscribe());
				yield* Effect.yieldNow;
				yield* publishAll(allPassEvents);
				const a = yield* Fiber.join(fiberA);
				const b = yield* Fiber.join(fiberB);
				return { a, b };
			}),
		).pipe(Effect.provide(RunEventChannelLive));

		const { a, b } = await Effect.runPromise(program);
		expect(a).toEqual(allPassEvents);
		expect(b).toEqual(allPassEvents);
	});
});

describe("RunEventChannel — renderStateStream", () => {
	it("emits one accumulated state per event", async () => {
		const program = Effect.scoped(
			Effect.gen(function* () {
				const seen = yield* Ref.make<ReadonlyArray<RenderState["phase"]>>([]);

				const consumer = Effect.gen(function* () {
					const stream = yield* renderStateStream();
					yield* stream.pipe(Stream.runForEach((state) => Ref.update(seen, (xs) => [...xs, state.phase])));
				});

				const fiber = yield* Effect.forkChild(consumer);
				yield* Effect.yieldNow;
				yield* publishAll(allPassEvents);
				// Give the scan time to drain before we interrupt.
				yield* Effect.sleep("50 millis");
				yield* Fiber.interrupt(fiber);
				return yield* Ref.get(seen);
			}),
		).pipe(Effect.provide(RunEventChannelLive));

		const phases = await Effect.runPromise(program);
		// Stream.scan emits the initial seed first, then one state per event
		// — total count is events.length + 1. We assert the terminal phase
		// rather than a brittle exact-length check.
		expect(phases.at(-1)).toBe("finished");
		expect(phases.length).toBe(allPassEvents.length + 1);
	});
});

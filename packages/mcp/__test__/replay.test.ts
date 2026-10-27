/**
 * Idempotent replay for the write tools: `@effected/mcp`'s `ToolReplay` over
 * the engine's `mcp_idempotent_responses` table (`replayed` in `src/replay.ts`).
 * The key-derivation cases are ported from the retired `withIdempotency`
 * registry and pin the stored keys byte-for-byte, because rows written by
 * earlier servers must keep replaying; the remaining cases pin the store
 * adapter against a real (in-memory) `DataStoreTestLayer`: a pre-existing row
 * replays, a miss stores under the same `(procedure_path, key)`, and store
 * faults, corrupt rows, `ok: false` results and handler failures never turn
 * into a tool error or a stored replay.
 */

import { DataReader, DataStore } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import { DataStoreError } from "@vitest-agent/sdk";
import { Effect, Layer, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	hypothesisReplayKey,
	replayed,
	tddBehaviorReplayKey,
	tddGoalReplayKey,
	tddTaskReplayKey,
} from "../src/replay.js";
import { IdempotentReplayMarker } from "../src/utils/replay-marker.js";

describe("replay keys (identical to the keys stored before ToolReplay)", () => {
	it("hypothesis validate keys on id and outcome; record is never replayed", () => {
		expect(hypothesisReplayKey({ action: "validate", id: 7, outcome: "confirmed" })).toEqual(
			Option.some("validate:7:confirmed"),
		);
		expect(hypothesisReplayKey({ action: "record", content: "my hypothesis" })).toEqual(Option.none());
		expect(hypothesisReplayKey({ action: "list" })).toEqual(Option.none());
	});

	it("tdd_task start keys on the id form plus runId, else the goal", () => {
		expect(tddTaskReplayKey({ action: "start", sessionId: 7, goal: "add foo" })).toEqual(
			Option.some("start:sid:7:add foo"),
		);
		expect(tddTaskReplayKey({ action: "start", chatId: "cc-abc", goal: "add foo" })).toEqual(
			Option.some("start:chat:cc-abc:add foo"),
		);
		expect(tddTaskReplayKey({ action: "start", sessionId: 7, goal: "g", runId: "xyz" })).toEqual(
			Option.some("start:sid:7:run:xyz"),
		);
		expect(tddTaskReplayKey({ action: "start", chatId: "c", goal: "g", runId: "xyz" })).toEqual(
			Option.some("start:chat:c:run:xyz"),
		);
		// sessionId wins over chatId, as before.
		expect(tddTaskReplayKey({ action: "start", sessionId: 3, chatId: "c", goal: "g" })).toEqual(
			Option.some("start:sid:3:g"),
		);
	});

	it("tdd_task start with neither id form is not replayed", () => {
		expect(tddTaskReplayKey({ action: "start", goal: "g" })).toEqual(Option.none());
		expect(tddTaskReplayKey({ action: "start", goal: "g", runId: "xyz" })).toEqual(Option.none());
	});

	it("tdd_task end keys on task id and outcome; get and resume are queries", () => {
		expect(tddTaskReplayKey({ action: "end", tddTaskId: 5, outcome: "succeeded" })).toEqual(
			Option.some("end:5:succeeded"),
		);
		expect(tddTaskReplayKey({ action: "get", tddTaskId: 1 })).toEqual(Option.none());
		expect(tddTaskReplayKey({ action: "resume", tddTaskId: 1 })).toEqual(Option.none());
	});

	it("tdd_goal and tdd_behavior create key on parent id and text; other actions are not replayed", () => {
		expect(tddGoalReplayKey({ action: "create", tddTaskId: 1, goal: "g" })).toEqual(Option.some("create:1:g"));
		expect(tddGoalReplayKey({ action: "update", id: 1 })).toEqual(Option.none());
		expect(tddBehaviorReplayKey({ action: "create", goalId: 1, behavior: "b" })).toEqual(Option.some("create:1:b"));
		expect(tddBehaviorReplayKey({ action: "update", id: 1 })).toEqual(Option.none());
	});
});

describe("replayed (ToolReplay over mcp_idempotent_responses)", () => {
	const Created = Schema.Struct({ ok: Schema.Literal(true), id: Schema.Number, ...IdempotentReplayMarker });
	const NotFound = Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ _tag: Schema.String }) });
	const Result = Schema.Union([Created, NotFound]);
	interface Params {
		readonly id: number;
	}

	const make = (result: (params: Params) => Effect.Effect<typeof Result.Type, string>) => {
		let calls = 0;
		const handler = replayed({
			tool: "tdd_goal",
			success: Result,
			key: (params: Params) => Option.some(`create:${params.id}:g`),
		})((params: Params) =>
			Effect.suspend(() => {
				calls++;
				return result(params);
			}),
		);
		return { handler, calls: () => calls };
	};

	const findRow = (key: string) =>
		Effect.flatMap(DataReader, (reader) => reader.findIdempotentResponse("tdd_goal", key));

	it("replays a row stored before ToolReplay under the same (procedure_path, key), with the marker", async () => {
		const { handler, calls } = make(() => Effect.succeed({ ok: true as const, id: 999 }));
		const replay = await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.recordIdempotentResponse({
					procedurePath: "tdd_goal",
					key: "create:1:g",
					// The legacy writer stored `JSON.stringify(result)`, undeclared keys included.
					resultJson: JSON.stringify({ ok: true, id: 1, extra: "dropped" }),
					createdAt: new Date().toISOString(),
				});
				return yield* handler({ id: 1 });
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);
		expect(calls()).toBe(0);
		expect(replay).toEqual({ ok: true, id: 1, _idempotentReplay: true });
	});

	it("miss: runs once, stores under the table's own coordinates, and the next call replays", async () => {
		const { handler, calls } = make((params) => Effect.succeed({ ok: true as const, id: params.id }));
		const { first, second, row } = await Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* handler({ id: 2 });
				const second = yield* handler({ id: 2 });
				const row = yield* findRow("create:2:g");
				return { first, second, row };
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);
		expect(calls()).toBe(1);
		expect(first).toEqual({ ok: true, id: 2 });
		expect(second).toEqual({ ok: true, id: 2, _idempotentReplay: true });
		expect(Option.map(row, (json) => JSON.parse(json))).toEqual(Option.some({ ok: true, id: 2 }));
	});

	it("an ok: false result is never stored, so it never replays", async () => {
		const { handler, calls } = make(() =>
			Effect.succeed({ ok: false as const, error: { _tag: "TddTaskNotFoundError" } }),
		);
		const row = await Effect.runPromise(
			Effect.gen(function* () {
				yield* handler({ id: 3 });
				yield* handler({ id: 3 });
				return yield* findRow("create:3:g");
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);
		expect(calls()).toBe(2);
		expect(Option.isNone(row)).toBe(true);
	});

	it("a handler failure stores nothing and propagates, so a retry runs again", async () => {
		const { handler, calls } = make(() => Effect.fail("boom"));
		const outcome = await Effect.runPromise(
			Effect.gen(function* () {
				const a = yield* Effect.flip(handler({ id: 4 }));
				const b = yield* Effect.flip(handler({ id: 4 }));
				const row = yield* findRow("create:4:g");
				return { a, b, row };
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);
		expect(calls()).toBe(2);
		expect(outcome.a).toBe("boom");
		expect(Option.isNone(outcome.row)).toBe(true);
	});

	it("a corrupt row is a miss once; the fresh result replaces it and the next call replays (issue #423)", async () => {
		const { handler, calls } = make((params) => Effect.succeed({ ok: true as const, id: params.id }));
		const { first, second } = await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.recordIdempotentResponse({
					procedurePath: "tdd_goal",
					key: "create:5:g",
					resultJson: "{not json",
					createdAt: new Date().toISOString(),
				});
				const first = yield* handler({ id: 5 });
				const second = yield* handler({ id: 5 });
				return { first, second };
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);
		expect(calls()).toBe(1);
		expect(first).toEqual({ ok: true, id: 5 });
		expect(second).toEqual({ ok: true, id: 5, _idempotentReplay: true });
	});

	it("store faults on read and write are swallowed: the handler's result is still returned", async () => {
		const failing = new DataStoreError({ operation: "write", table: "mcp_idempotent_responses", reason: "boom" });
		const Broken = Layer.mergeAll(
			Layer.effect(
				DataStore,
				Effect.map(DataStore, (real) => ({
					...real,
					recordIdempotentResponse: () => Effect.fail(failing),
				})),
			),
			Layer.effect(
				DataReader,
				Effect.map(DataReader, (real) => ({
					...real,
					findIdempotentResponse: () => Effect.fail(failing),
				})),
			),
		).pipe(Layer.provideMerge(DataStoreTestLayer));
		const { handler, calls } = make((params) => Effect.succeed({ ok: true as const, id: params.id }));
		const [first, second] = await Effect.runPromise(
			Effect.all([handler({ id: 6 }), handler({ id: 6 })]).pipe(Effect.provide(Broken)),
		);
		expect(calls()).toBe(2);
		expect(first).toEqual({ ok: true, id: 6 });
		expect(second).toEqual({ ok: true, id: 6 });
	});
});

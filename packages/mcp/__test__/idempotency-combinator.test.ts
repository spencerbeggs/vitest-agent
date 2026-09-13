/**
 * `withIdempotency` — the Effect-native idempotency combinator that
 * replaced the tRPC `idempotentProcedure` middleware (deleted with the
 * middleware once every write tool is ported). Key-derivation cases are
 * ported from `idempotency.test.ts`; the remaining cases pin the
 * combinator's cache hit / miss / null-key / persist-failure / non-object
 * replay semantics against a real (in-memory) `DataStoreTestLayer`.
 */

import { DataReader, DataStore } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import { DataStoreError } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { idempotencyKeys, withIdempotency } from "../src/idempotency.js";

describe("idempotency key derivation (registry)", () => {
	const spec = (path: string) => {
		const s = idempotencyKeys.find((k) => k.procedurePath === path);
		if (!s) throw new Error(`No idempotency spec registered for "${path}"`);
		return s;
	};

	describe("hypothesis (consolidated)", () => {
		const { deriveKey } = spec("hypothesis");

		it("record action is not idempotent (append-only, server-resolved session): returns null", () => {
			expect(deriveKey({ action: "record", content: "my hypothesis" })).toBeNull();
			expect(deriveKey({ action: "record", sessionId: 42, content: "my hypothesis" })).toBeNull();
		});

		it("validate action: id:outcome key", () => {
			expect(deriveKey({ action: "validate", id: 7, outcome: "confirmed" })).toBe("validate:7:confirmed");
		});

		it("returns null when action is missing", () => {
			expect(deriveKey({ sessionId: 1, content: "x" })).toBeNull();
		});

		it("returns null for malformed inputs", () => {
			expect(deriveKey(null)).toBeNull();
			expect(deriveKey({ action: "validate", id: "x", outcome: "confirmed" })).toBeNull();
		});
	});

	describe("tdd_task (consolidated)", () => {
		const { deriveKey } = spec("tdd_task");

		it("start: keys on (sessionId, goal) when no runId", () => {
			expect(deriveKey({ action: "start", sessionId: 7, goal: "add foo" })).toBe("start:sid:7:add foo");
		});

		it("start: keys on (chatId, goal) when no runId and no sessionId", () => {
			expect(deriveKey({ action: "start", chatId: "cc-abc", goal: "add foo" })).toBe("start:chat:cc-abc:add foo");
		});

		it("start: prefers runId over goal", () => {
			expect(deriveKey({ action: "start", sessionId: 7, goal: "g", runId: "xyz" })).toBe("start:sid:7:run:xyz");
		});

		it("end: keys on (tddTaskId, outcome)", () => {
			expect(deriveKey({ action: "end", tddTaskId: 5, outcome: "succeeded" })).toBe("end:5:succeeded");
		});

		it("returns null for non-create/end actions (get/resume are queries)", () => {
			expect(deriveKey({ action: "get", id: 1 })).toBeNull();
		});
	});

	describe("tdd_goal (consolidated)", () => {
		const { deriveKey } = spec("tdd_goal");

		it("create: keys on (tddTaskId, goal)", () => {
			expect(deriveKey({ action: "create", tddTaskId: 1, goal: "g" })).toBe("create:1:g");
		});

		it("returns null for non-create actions", () => {
			expect(deriveKey({ action: "update", id: 1 })).toBeNull();
		});
	});

	describe("tdd_behavior (consolidated)", () => {
		const { deriveKey } = spec("tdd_behavior");

		it("create: keys on (goalId, behavior)", () => {
			expect(deriveKey({ action: "create", goalId: 1, behavior: "b" })).toBe("create:1:b");
		});

		it("returns null for non-create actions", () => {
			expect(deriveKey({ action: "update", id: 1 })).toBeNull();
		});
	});
});

describe("withIdempotency", () => {
	interface ValidateParams {
		readonly action: "validate";
		readonly id: number;
		readonly outcome: string;
	}

	it("miss: runs the handler once and persists the result, readable via findIdempotentResponse", async () => {
		let calls = 0;
		const handler = withIdempotency("hypothesis", (params: ValidateParams) =>
			Effect.sync(() => {
				calls++;
				return { id: params.id, outcome: params.outcome };
			}),
		);
		const params: ValidateParams = { action: "validate", id: 101, outcome: "confirmed" };

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* handler(params);
				const reader = yield* DataReader;
				const stored = yield* reader.findIdempotentResponse("hypothesis", "validate:101:confirmed");
				return { first, stored };
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);

		expect(calls).toBe(1);
		expect(result.first).toEqual({ id: 101, outcome: "confirmed" });
		expect(result.stored._tag).toBe("Some");
		if (result.stored._tag === "Some") {
			expect(JSON.parse(result.stored.value)).toEqual({ id: 101, outcome: "confirmed" });
		}
	});

	it("hit: does not run the handler again, and the replay carries _idempotentReplay: true", async () => {
		let calls = 0;
		const handler = withIdempotency("hypothesis", (params: ValidateParams) =>
			Effect.sync(() => {
				calls++;
				return { id: params.id, outcome: params.outcome };
			}),
		);
		const params: ValidateParams = { action: "validate", id: 202, outcome: "refuted" };

		const [first, second] = await Effect.runPromise(
			Effect.gen(function* () {
				const a = yield* handler(params);
				const b = yield* handler(params);
				return [a, b] as const;
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);

		expect(calls).toBe(1);
		expect(first).toEqual({ id: 202, outcome: "refuted" });
		expect(second).toEqual({ id: 202, outcome: "refuted", _idempotentReplay: true });
	});

	it("null key: the handler runs every time and nothing is persisted", async () => {
		let calls = 0;
		const handler = withIdempotency("hypothesis", (params: { action: string; content: string }) =>
			Effect.sync(() => {
				calls++;
				return { content: params.content };
			}),
		);
		const params = { action: "record", content: "no safe discriminator" };

		await Effect.runPromise(
			Effect.gen(function* () {
				yield* handler(params);
				yield* handler(params);
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);

		expect(calls).toBe(2);
	});

	it("unregistered path: the handler runs every time and nothing is persisted", async () => {
		let calls = 0;
		const handler = withIdempotency("not_a_registered_tool", (params: { value: number }) =>
			Effect.sync(() => {
				calls++;
				return { value: params.value };
			}),
		);

		await Effect.runPromise(
			Effect.gen(function* () {
				yield* handler({ value: 1 });
				yield* handler({ value: 1 });
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);

		expect(calls).toBe(2);
	});

	it("persistence failure is swallowed: the handler's result is still returned", async () => {
		let calls = 0;
		const handler = withIdempotency("hypothesis", (params: ValidateParams) =>
			Effect.sync(() => {
				calls++;
				return { id: params.id, outcome: params.outcome };
			}),
		);
		const params: ValidateParams = { action: "validate", id: 303, outcome: "confirmed" };

		const BrokenStore = Layer.effect(
			DataStore,
			Effect.gen(function* () {
				const real = yield* DataStore;
				return {
					...real,
					recordIdempotentResponse: () =>
						Effect.fail(new DataStoreError({ operation: "write", table: "mcp_idempotent_responses", reason: "boom" })),
				};
			}),
		).pipe(Layer.provideMerge(DataStoreTestLayer));

		const result = await Effect.runPromise(handler(params).pipe(Effect.provide(BrokenStore)));

		expect(calls).toBe(1);
		expect(result).toEqual({ id: 303, outcome: "confirmed" });
	});

	it("corrupt cached row: treated as a miss, the handler runs and its fresh result is returned", async () => {
		let calls = 0;
		const handler = withIdempotency("hypothesis", (params: ValidateParams) =>
			Effect.sync(() => {
				calls++;
				return { id: params.id, outcome: params.outcome };
			}),
		);
		const params: ValidateParams = { action: "validate", id: 404, outcome: "confirmed" };
		const key = "validate:404:confirmed";

		const { first, second } = await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.recordIdempotentResponse({
					procedurePath: "hypothesis",
					key,
					resultJson: "{not json",
					createdAt: new Date().toISOString(),
				});
				const first = yield* handler(params);
				const second = yield* handler(params);
				return { first, second };
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);

		expect(calls).toBe(2);
		expect(first).toEqual({ id: 404, outcome: "confirmed" });
		expect(second).toEqual({ id: 404, outcome: "confirmed" });
		expect(first).not.toHaveProperty("_idempotentReplay");
	});

	it("non-object cached payload passes through unchanged (no marker merge)", async () => {
		const handler = withIdempotency("tdd_goal", (_params: { action: string; tddTaskId: number; goal: string }) =>
			Effect.succeed("a plain string result" as unknown as { tddTaskId: number; goal: string }),
		);
		const params = { action: "create", tddTaskId: 9, goal: "g" };

		const [first, second] = await Effect.runPromise(
			Effect.gen(function* () {
				const a = yield* handler(params);
				const b = yield* handler(params);
				return [a, b] as const;
			}).pipe(Effect.provide(DataStoreTestLayer)),
		);

		expect(first).toBe("a plain string result");
		expect(second).toBe("a plain string result");
	});
});

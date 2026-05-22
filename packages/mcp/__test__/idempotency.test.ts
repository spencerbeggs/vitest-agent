import { describe, expect, it } from "vitest";
import { idempotencyKeys } from "../src/middleware/idempotency.js";

describe("idempotency key derivation", () => {
	const spec = (path: string) => {
		const s = idempotencyKeys.find((k) => k.procedurePath === path);
		if (!s) throw new Error(`No idempotency spec registered for "${path}"`);
		return s;
	};

	describe("hypothesis (consolidated)", () => {
		const { deriveKey } = spec("hypothesis");

		it("record action is not idempotent (append-only, server-resolved session): returns null", () => {
			// The binding session is resolved server-side and absent from the
			// input, so there is no safe discriminator to dedup on — content-only
			// keying would collide across sessions/runs. Record always writes.
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

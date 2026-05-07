import { describe, expect, it } from "vitest";
import { idempotencyKeys } from "../src/middleware/idempotency.js";

// ---------------------------------------------------------------------------
// Key derivation tests (pure logic, no I/O)
// ---------------------------------------------------------------------------

describe("idempotency key derivation", () => {
	const spec = (path: string) => {
		const s = idempotencyKeys.find((k) => k.procedurePath === path);
		if (!s) throw new Error(`No idempotency spec registered for "${path}"`);
		return s;
	};

	describe("hypothesis_record", () => {
		const { deriveKey } = spec("hypothesis_record");

		it("derives key as sessionId:content", () => {
			const key = deriveKey({ sessionId: 42, content: "my hypothesis" });
			expect(key).toBe("42:my hypothesis");
		});

		it("returns null for invalid input", () => {
			expect(deriveKey(null)).toBeNull();
			expect(deriveKey({ sessionId: "not-a-number", content: "x" })).toBeNull();
			expect(deriveKey({ sessionId: 1 })).toBeNull();
		});
	});

	describe("hypothesis_validate", () => {
		const { deriveKey } = spec("hypothesis_validate");

		it("derives key as id:outcome", () => {
			const key = deriveKey({ id: 7, outcome: "confirmed" });
			expect(key).toBe("7:confirmed");
		});

		it("returns null for invalid input", () => {
			expect(deriveKey(null)).toBeNull();
			expect(deriveKey({ id: "not-a-number", outcome: "confirmed" })).toBeNull();
			expect(deriveKey({ id: 1 })).toBeNull();
		});
	});

	describe("tdd_session_start", () => {
		const { deriveKey } = spec("tdd_session_start");

		it("derives a stable key from (sessionId, goal)", () => {
			expect(deriveKey({ sessionId: 7, goal: "add foo" })).toBe("sid:7:add foo");
			expect(deriveKey({ sessionId: 7, goal: "add foo" })).toBe(deriveKey({ sessionId: 7, goal: "add foo" }));
		});

		it("derives a stable key from (ccSessionId, goal) when sessionId is absent", () => {
			expect(deriveKey({ ccSessionId: "cc-abc", goal: "add foo" })).toBe("cc:cc-abc:add foo");
		});

		it("prefixes the kind so cc-id and integer-id namespaces never collide", () => {
			expect(deriveKey({ sessionId: 7, goal: "g" })).not.toBe(deriveKey({ ccSessionId: "7", goal: "g" }));
		});

		it("keys on runId when present, ignoring goal text", () => {
			expect(deriveKey({ ccSessionId: "cc-abc", goal: "add foo", runId: "abc123" })).toBe("cc:cc-abc:run:abc123");
		});

		it("keys on sessionId+runId when sessionId is present with runId", () => {
			expect(deriveKey({ sessionId: 7, goal: "g", runId: "xyz" })).toBe("sid:7:run:xyz");
		});

		it("falls back to goal-based key when runId is absent (backward compat)", () => {
			expect(deriveKey({ ccSessionId: "cc-abc", goal: "add foo" })).toBe("cc:cc-abc:add foo");
		});

		it("returns null for malformed input", () => {
			expect(deriveKey(null)).toBeNull();
			expect(deriveKey({ goal: "x" })).toBeNull();
			expect(deriveKey({ sessionId: "not-a-number", goal: "x" })).toBeNull();
		});
	});

	describe("tdd_session_end", () => {
		const { deriveKey } = spec("tdd_session_end");

		it("derives stable key from (tddSessionId, outcome)", () => {
			expect(deriveKey({ tddSessionId: 5, outcome: "succeeded" })).toBe("5:succeeded");
		});

		it("returns null for malformed input", () => {
			expect(deriveKey(null)).toBeNull();
			expect(deriveKey({ outcome: "succeeded" })).toBeNull();
			expect(deriveKey({ tddSessionId: 5 })).toBeNull();
		});
	});
});

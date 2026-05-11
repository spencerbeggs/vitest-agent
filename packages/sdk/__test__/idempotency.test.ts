import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_ROOT_SENTINEL, deriveIdempotencyKey } from "../src/services/idempotency.js";

describe("deriveIdempotencyKey", () => {
	it("is deterministic — same input always produces same output", () => {
		const input = {
			agentType: "claude-code-main",
			parentAgentId: null,
			clientNonce: "fixed-nonce-1",
		};
		expect(deriveIdempotencyKey(input)).toBe(deriveIdempotencyKey(input));
	});

	it("returns a 26-char base32 string (RFC 4648 alphabet, lowercase)", () => {
		const key = deriveIdempotencyKey({
			agentType: "claude-code-main",
			parentAgentId: null,
			clientNonce: "n1",
		});
		expect(key).toMatch(/^[a-z2-7]{26}$/);
		expect(key).toHaveLength(26);
	});

	it("treats null parentAgentId as the __ROOT__ sentinel", () => {
		const withNull = deriveIdempotencyKey({
			agentType: "claude-code-main",
			parentAgentId: null,
			clientNonce: "n1",
		});
		const withSentinel = deriveIdempotencyKey({
			agentType: "claude-code-main",
			parentAgentId: IDEMPOTENCY_ROOT_SENTINEL,
			clientNonce: "n1",
		});
		expect(withNull).toBe(withSentinel);
	});

	it("produces distinct keys when agentType differs", () => {
		const main = deriveIdempotencyKey({
			agentType: "claude-code-main",
			parentAgentId: null,
			clientNonce: "n1",
		});
		const subagent = deriveIdempotencyKey({
			agentType: "claude-code-tdd-task",
			parentAgentId: null,
			clientNonce: "n1",
		});
		expect(main).not.toBe(subagent);
	});

	it("produces distinct keys when parentAgentId differs", () => {
		const root = deriveIdempotencyKey({
			agentType: "claude-code-tdd-task",
			parentAgentId: null,
			clientNonce: "n1",
		});
		const child = deriveIdempotencyKey({
			agentType: "claude-code-tdd-task",
			parentAgentId: "1234abcd-1234-1234-1234-1234abcd1234",
			clientNonce: "n1",
		});
		expect(root).not.toBe(child);
	});

	it("produces distinct keys when clientNonce differs (sibling subagent disambiguation)", () => {
		const sibA = deriveIdempotencyKey({
			agentType: "claude-code-tdd-task",
			parentAgentId: "1234abcd-1234-1234-1234-1234abcd1234",
			clientNonce: "sibling-A",
		});
		const sibB = deriveIdempotencyKey({
			agentType: "claude-code-tdd-task",
			parentAgentId: "1234abcd-1234-1234-1234-1234abcd1234",
			clientNonce: "sibling-B",
		});
		expect(sibA).not.toBe(sibB);
	});

	// Vector test — fixes the exact output for known inputs so neither caller
	// (sidecar CLI or MCP server) can drift from the canonical implementation.
	// If this changes, every existing agents.idempotency_key row is invalidated.
	it("matches frozen vector outputs (drift guard)", () => {
		expect(
			deriveIdempotencyKey({
				agentType: "claude-code-main",
				parentAgentId: null,
				clientNonce: "vector-nonce-main",
			}),
		).toBe("dnz5gfbhjbj5ge4yjuanwn3ant");

		expect(
			deriveIdempotencyKey({
				agentType: "claude-code-tdd-task",
				parentAgentId: "agent-uuid-parent",
				clientNonce: "vector-nonce-sub",
			}),
		).toBe("pyz6k4mummb6ktoe2rug2rb5gs");
	});
});

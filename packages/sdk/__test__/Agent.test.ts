import { Effect, Match, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { RegisterAgentResult } from "../src/schemas/Agent.js";
import { Agent, IdempotencyHit } from "../src/schemas/Agent.js";

const VALID_UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID_C = "770e8400-e29b-41d4-a716-446655440002";
const VALID_UUID_D = "880e8400-e29b-41d4-a716-446655440003";

describe("Agent (Schema.TaggedClass)", () => {
	it("constructs from a literal with all required fields", () => {
		const agent = new Agent({
			agentId: Schema.decodeUnknownSync(Schema.String.check(Schema.isUUID()))(VALID_UUID_A),
			sessionId: 1,
			parentAgentId: null,
			conversationId: Schema.decodeUnknownSync(Schema.String.check(Schema.isUUID()))(VALID_UUID_C),
			agentType: "claude-code-main",
			startedAt: 1700000000,
			endedAt: null,
			startGitBranch: "main",
			startGitCommitSha: "abcdef",
			startWorktreeDir: "/repo",
			idempotencyKey: "abcd1234abcd1234abcd1234ab",
		} as never);
		expect(agent.agentType).toBe("claude-code-main");
		expect(agent._tag).toBe("Agent");
	});

	it("rejects construction with an invalid UUID via decodeUnknown", () => {
		expect(() =>
			Effect.runSync(
				Schema.decodeUnknownEffect(Agent)({
					_tag: "Agent",
					agentId: "not-a-uuid",
					sessionId: 1,
					parentAgentId: null,
					conversationId: null,
					agentType: "claude-code-main",
					startedAt: 0,
					endedAt: null,
					startGitBranch: null,
					startGitCommitSha: null,
					startWorktreeDir: null,
					idempotencyKey: "x",
				} as never),
			),
		).toThrow();
	});

	it("decodes a tagged literal with valid UUIDs", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(Agent)({
				_tag: "Agent",
				agentId: VALID_UUID_A,
				sessionId: 1,
				parentAgentId: VALID_UUID_C,
				conversationId: VALID_UUID_D,
				agentType: "claude-code-tdd-task",
				startedAt: 1700000000,
				endedAt: null,
				startGitBranch: "feat/x",
				startGitCommitSha: "1a2b3c",
				startWorktreeDir: "/work",
				idempotencyKey: "k",
			} as never),
		);
		expect(decoded._tag).toBe("Agent");
		expect(decoded.agentId).toBe(VALID_UUID_A);
		expect(decoded.parentAgentId).toBe(VALID_UUID_C);
	});
});

describe("IdempotencyHit", () => {
	it("carries the existing agentId", () => {
		const hit = new IdempotencyHit({
			existingAgentId: Schema.decodeUnknownSync(Schema.String.check(Schema.isUUID()))(VALID_UUID_A) as never,
		});
		expect(hit._tag).toBe("IdempotencyHit");
		expect(hit.existingAgentId).toBe(VALID_UUID_A);
	});
});

describe("RegisterAgentResult dispatch via Match.tag", () => {
	const agent = new Agent({
		agentId: Schema.decodeUnknownSync(Schema.String.check(Schema.isUUID()))(VALID_UUID_A),
		// sessionId is an integer FK to sessions.id, not a UUID — it
		// references the per-project sessions table's auto-increment PK.
		sessionId: 1,
		parentAgentId: null,
		conversationId: null,
		agentType: "claude-code-main",
		startedAt: 0,
		endedAt: null,
		startGitBranch: null,
		startGitCommitSha: null,
		startWorktreeDir: null,
		idempotencyKey: "k",
	} as never);

	const hit = new IdempotencyHit({
		existingAgentId: Schema.decodeUnknownSync(Schema.String.check(Schema.isUUID()))(VALID_UUID_A) as never,
	});

	const dispatch = (r: RegisterAgentResult) =>
		Match.value(r).pipe(
			Match.tag("Agent", (a) => `agent:${a.agentType}`),
			Match.tag("IdempotencyHit", (h) => `hit:${h.existingAgentId}`),
			Match.exhaustive,
		);

	it("dispatches to the Agent branch when given an Agent", () => {
		expect(dispatch(agent)).toBe("agent:claude-code-main");
	});

	it("dispatches to the IdempotencyHit branch when given an IdempotencyHit", () => {
		expect(dispatch(hit)).toBe(`hit:${VALID_UUID_A}`);
	});
});

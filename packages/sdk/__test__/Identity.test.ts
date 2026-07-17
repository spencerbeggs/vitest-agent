import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	ActorType,
	AgentId,
	ChatId,
	ConversationId,
	HostKind,
	ProjectKey,
	TddTaskId,
} from "../src/schemas/Identity.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

const expectsUuidJsonSchema = (schema: Schema.Codec<unknown, string>): void => {
	const doc = Schema.toJsonSchemaDocument(schema);
	// v4 emits the `format`/`pattern` constraints under `allOf` for a checked
	// String; v3's `Schema.UUID` put them at the top level.
	const node = doc.schema as {
		format?: string;
		pattern?: string;
		allOf?: ReadonlyArray<{ format?: string; pattern?: string }>;
	};
	const constraint = node.allOf?.find((c) => c.format !== undefined) ?? node;
	expect(constraint.format).toBe("uuid");
	expect(typeof constraint.pattern).toBe("string");
};

describe("AgentId", () => {
	it("decodes a valid UUID", () => {
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(AgentId)(VALID_UUID));
		expect(decoded).toBe(VALID_UUID);
	});

	it("rejects a non-UUID string", () => {
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(AgentId)("not-a-uuid"))).toThrow();
	});

	it("rejects a non-string value", () => {
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(AgentId)(42))).toThrow();
	});

	it("emits format=uuid in JSON Schema (cross-wire safety)", () => {
		expectsUuidJsonSchema(AgentId as never);
	});
});

describe("ConversationId", () => {
	it("decodes a valid UUID", () => {
		expect(Effect.runSync(Schema.decodeUnknownEffect(ConversationId)(VALID_UUID))).toBe(VALID_UUID);
	});

	it("rejects a non-UUID string", () => {
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(ConversationId)("nope"))).toThrow();
	});

	it("emits format=uuid in JSON Schema", () => {
		expectsUuidJsonSchema(ConversationId as never);
	});
});

describe("ChatId", () => {
	it("decodes a valid UUID", () => {
		expect(Effect.runSync(Schema.decodeUnknownEffect(ChatId)(VALID_UUID))).toBe(VALID_UUID);
	});

	it("rejects a non-UUID string", () => {
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(ChatId)("nope"))).toThrow();
	});

	it("emits format=uuid in JSON Schema", () => {
		expectsUuidJsonSchema(ChatId as never);
	});
});

describe("TddTaskId", () => {
	it("decodes a valid UUID", () => {
		expect(Effect.runSync(Schema.decodeUnknownEffect(TddTaskId)(VALID_UUID))).toBe(VALID_UUID);
	});

	it("rejects a non-UUID string", () => {
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(TddTaskId)("nope"))).toThrow();
	});

	it("emits format=uuid in JSON Schema", () => {
		expectsUuidJsonSchema(TddTaskId as never);
	});
});

describe("ProjectKey", () => {
	it("decodes a normalized package name", () => {
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(ProjectKey)("vitest-agent"));
		expect(decoded).toBe("vitest-agent");
	});

	it("decodes a scope-normalized name with double underscores", () => {
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(ProjectKey)("@spencerbeggs__vitest-agent"));
		expect(decoded).toBe("@spencerbeggs__vitest-agent");
	});

	it("rejects empty string", () => {
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(ProjectKey)(""))).toThrow();
	});

	it("rejects a non-string", () => {
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(ProjectKey)(42))).toThrow();
	});
});

describe("ActorType", () => {
	it("accepts each known literal", () => {
		expect(Effect.runSync(Schema.decodeUnknownEffect(ActorType)("agent"))).toBe("agent");
		expect(Effect.runSync(Schema.decodeUnknownEffect(ActorType)("user"))).toBe("user");
		expect(Effect.runSync(Schema.decodeUnknownEffect(ActorType)("system"))).toBe("system");
	});

	it("rejects unknown values", () => {
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(ActorType)("ci"))).toThrow();
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(ActorType)("AGENT"))).toThrow();
	});
});

describe("HostKind", () => {
	it("accepts canonical Claude Code host kind", () => {
		expect(Effect.runSync(Schema.decodeUnknownEffect(HostKind)("claude-code"))).toBe("claude-code");
	});

	it("accepts other known canonical host kinds", () => {
		expect(Effect.runSync(Schema.decodeUnknownEffect(HostKind)("cursor"))).toBe("cursor");
		expect(Effect.runSync(Schema.decodeUnknownEffect(HostKind)("goose"))).toBe("goose");
		expect(Effect.runSync(Schema.decodeUnknownEffect(HostKind)("unknown"))).toBe("unknown");
	});

	it("rejects an unrecognized host kind", () => {
		expect(() => Effect.runSync(Schema.decodeUnknownEffect(HostKind)("not-a-host"))).toThrow();
	});
});

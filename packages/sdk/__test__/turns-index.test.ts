import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TurnPayload } from "../src/schemas/turns/index.js";

describe("TurnPayload union", () => {
	it("decodes a hook_fire payload", () => {
		const result = Schema.decodeUnknownSync(TurnPayload)({
			type: "hook_fire",
			hook_kind: "SessionStart",
			cc_session_id: "cc-1",
		});
		expect(result.type).toBe("hook_fire");
	});

	it("rejects unknown type discriminator", () => {
		expect(() =>
			Schema.decodeUnknownSync(TurnPayload)({
				type: "telephone",
			}),
		).toThrow();
	});
});

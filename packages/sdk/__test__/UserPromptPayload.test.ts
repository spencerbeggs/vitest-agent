import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { UserPromptPayload } from "../src/schemas/turns/UserPromptPayload.js";

describe("UserPromptPayload", () => {
	it("accepts a valid prompt payload", () => {
		const result = Schema.decodeUnknownSync(UserPromptPayload)({
			type: "user_prompt",
			prompt: "fix this test",
		});
		expect(result.prompt).toBe("fix this test");
	});

	it("rejects wrong discriminator", () => {
		expect(() =>
			Schema.decodeUnknownSync(UserPromptPayload)({
				type: "tool_call",
				prompt: "fix this test",
			}),
		).toThrow();
	});

	it("accepts optional cc_message_id", () => {
		const result = Schema.decodeUnknownSync(UserPromptPayload)({
			type: "user_prompt",
			prompt: "p",
			cc_message_id: "msg-1",
		});
		expect(result.cc_message_id).toBe("msg-1");
	});
});

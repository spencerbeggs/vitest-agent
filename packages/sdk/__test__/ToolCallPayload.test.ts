import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ToolCallPayload } from "../src/schemas/turns/ToolCallPayload.js";

describe("ToolCallPayload", () => {
	it("accepts a valid tool call payload", () => {
		const result = Schema.decodeUnknownSync(ToolCallPayload)({
			type: "tool_call",
			tool_name: "Bash",
			tool_input: { command: "ls" },
		});
		expect(result.tool_name).toBe("Bash");
	});

	it("accepts arbitrary tool_input shape", () => {
		const result = Schema.decodeUnknownSync(ToolCallPayload)({
			type: "tool_call",
			tool_name: "Edit",
			tool_input: { path: "x.ts", old_string: "a", new_string: "b" },
		});
		expect((result.tool_input as Record<string, unknown>).path).toBe("x.ts");
	});
});

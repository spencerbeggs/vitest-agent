import { ConsoleLeaks } from "@vitest-agent/sdk";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

describe("ConsoleLeaks schema", () => {
	it("round-trips a full value through encode/decode", () => {
		const value: ConsoleLeaks = {
			total: 7,
			byFile: [
				{
					file: "packages/x/foo.test.ts",
					stdout: 5,
					stderr: 2,
					tests: ["leaks when fetching"],
					sample: "DEBUG cache miss",
				},
			],
			truncated: true,
		};
		const encoded = Schema.encodeSync(ConsoleLeaks)(value);
		const decoded = Schema.decodeUnknownSync(ConsoleLeaks)(encoded);
		expect(decoded).toEqual(value);
	});

	it("decodes a minimal value (optional fields omitted)", () => {
		const decoded = Schema.decodeUnknownSync(ConsoleLeaks)({
			total: 1,
			byFile: [{ file: "a.test.ts", stdout: 1, stderr: 0 }],
		});
		expect(decoded.byFile[0].tests).toBeUndefined();
		expect(decoded.truncated).toBeUndefined();
	});
});

import { describe, expect, it } from "vitest";
import { failureCode } from "../src/lib/failure-code.js";

describe("failureCode", () => {
	it.each([
		["RegistrationConflictError", 1],
		["SidecarTimeoutError", 2],
		["DataStoreError", 3],
		["ProjectIdentityNotResolvableError", 4],
		["AgentNotFoundError", 5],
	])("maps a %s failure to exit %i", (tag, code) => {
		expect(failureCode({ _tag: tag })).toBe(code);
	});

	it.each([
		["an Error", new Error("boom")],
		["a string", "plain"],
		["null", null],
		["undefined", undefined],
		["a non-string tag", { _tag: 3 }],
		[
			"a throwing tag getter",
			{
				get _tag(): string {
					throw new Error("hostile");
				},
			},
		],
	])("gives %s the defect code", (_label, error) => {
		expect(failureCode(error)).toBe(5);
	});
});

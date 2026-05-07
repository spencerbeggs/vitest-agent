import { Cause } from "effect";
import { describe, expect, it } from "vitest";
import { DataStoreError } from "../src/errors/DataStoreError.js";
import { formatFatalError } from "../src/utils/format-fatal-error.js";

const ISSUE_URL = "https://github.com/spencerbeggs/vitest-agent/issues";

describe("formatFatalError", () => {
	it("formats a plain Error with message and stack", () => {
		const err = new Error("something broke");
		const result = formatFatalError(err);
		expect(result).toContain("something broke");
		expect(result).toContain(ISSUE_URL);
		// Stack trace should be present
		expect(result).toMatch(/format-fatal-error\.test/);
	});

	it("formats an Effect FiberFailure with Die cause", () => {
		const defect = new Error("unexpected defect");
		const cause = Cause.die(defect);
		const fiberFailure = Object.assign(new Error(), {
			[Symbol.for("effect/Runtime/FiberFailure")]: "FiberFailure",
			[Symbol.for("effect/Runtime/FiberFailure/Cause")]: cause,
		});
		const result = formatFatalError(fiberFailure);
		expect(result).toContain("unexpected defect");
		expect(result).toContain(ISSUE_URL);
	});

	it("formats an Effect FiberFailure with Fail cause", () => {
		const cause = Cause.fail({ _tag: "DataStoreError", operation: "write", table: "test_runs", reason: "disk full" });
		const fiberFailure = Object.assign(new Error(), {
			[Symbol.for("effect/Runtime/FiberFailure")]: "FiberFailure",
			[Symbol.for("effect/Runtime/FiberFailure/Cause")]: cause,
		});
		const result = formatFatalError(fiberFailure);
		expect(result).toContain("DataStoreError");
		expect(result).toContain(ISSUE_URL);
	});

	it("surfaces DataStoreError fields when wrapped in a Cause.fail", () => {
		const err = new DataStoreError({
			operation: "write",
			table: "test_history",
			reason: "UNIQUE constraint failed: test_history.full_name",
		});
		const cause = Cause.fail(err);
		const result = formatFatalError(cause);
		expect(result).toContain("DataStoreError");
		expect(result).toContain("[write test_history]");
		expect(result).toContain("UNIQUE constraint failed: test_history.full_name");
	});

	it("formats a direct Cause object", () => {
		const cause = Cause.die(new Error("direct cause"));
		const result = formatFatalError(cause);
		expect(result).toContain("direct cause");
		expect(result).toContain(ISSUE_URL);
	});

	it("formats a string input", () => {
		const result = formatFatalError("raw string error");
		expect(result).toContain("raw string error");
		expect(result).toContain(ISSUE_URL);
	});

	it("formats null input", () => {
		const result = formatFatalError(null);
		expect(result).toContain("null");
		expect(result).toContain(ISSUE_URL);
	});

	it("formats an object without FiberFailure symbol", () => {
		const result = formatFatalError({ code: 42, msg: "oops" });
		expect(result).toContain("oops");
		expect(result).toContain(ISSUE_URL);
	});
});

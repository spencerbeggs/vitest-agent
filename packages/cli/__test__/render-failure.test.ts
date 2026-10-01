import { Cancelled, NotInteractive } from "@effected/cli";
import { Cause, Data, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { renderFailure } from "../src/lib/render-failure.js";

class SqlError extends Data.TaggedError("SqlError")<{ readonly message: string }> {}

// `defaultLines` stands in for the run's painted report; renderFailure must never echo it (it leads with `[FAIL]`).
const DEFAULT_LINES = ["[FAIL] the run's own report"];
const typed = (error: unknown) =>
	renderFailure(error, { cause: Cause.fail(error), isDefect: false, defaultLines: DEFAULT_LINES });
const defect = (error: unknown) =>
	renderFailure(error, { cause: Cause.die(error), isDefect: true, defaultLines: DEFAULT_LINES });

describe("renderFailure", () => {
	it("renders a typed failure as the one `vitest-agent: <Tag>: <message>` line", () => {
		expect(typed(new SqlError({ message: "no such table: runs" }))).toEqual([
			"vitest-agent: SqlError: no such table: runs",
		]);
	});

	it("names a typed failure by its _tag over its Error name", () => {
		const error = Object.assign(new Error("mkdir failed"), { _tag: "PlatformError" });
		expect(typed(error)).toEqual(["vitest-agent: PlatformError: mkdir failed"]);
	});

	it("keeps the kit's fixed line for Cancelled, prefixed", () => {
		expect(typed(Cancelled.make({ reason: "interrupt" }))).toEqual(["vitest-agent: cancelled; nothing written"]);
	});

	it("keeps the kit's fixed line for NotInteractive, prefixed", () => {
		expect(typed(NotInteractive.make({}))).toEqual([
			"vitest-agent: not interactive: run in a terminal or pass the flag",
		]);
	});

	it("delegates a SchemaError to the kit's tree of rejected values", () => {
		const exit = Schema.decodeUnknownExit(Schema.Struct({ n: Schema.Number }))({ n: "x" });
		if (exit._tag !== "Failure") throw new Error("expected the decode to fail");
		const lines = renderFailure(Cause.squash(exit.cause), {
			cause: exit.cause,
			isDefect: false,
			defaultLines: DEFAULT_LINES,
		});

		expect(lines[0]).toMatch(/^vitest-agent: /);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.slice(1).join("\n")).toContain("n: Expected number");
	});

	it("sanitizes the message of a typed failure to one control-free line", () => {
		const error = new SqlError({ message: "bad\u001b[31m red\u0007\nsecond line" });
		expect(typed(error)).toEqual(["vitest-agent: SqlError: bad red second line"]);
	});

	it("never doubles the status marker after the prefix", () => {
		for (const lines of [typed(Cancelled.make({ reason: "interrupt" })), defect(new Error("boom"))]) {
			expect(lines[0]).not.toMatch(/^vitest-agent: (\[FAIL\]|[✗✖×])/);
			expect(lines).not.toContain(DEFAULT_LINES[0]);
		}
	});

	it("renders a defect as the kit's cleaned stack followed by the issue link", () => {
		const lines = defect(new Error("boom"));

		expect(lines[0]).toMatch(/^vitest-agent: .*Error: boom$/);
		expect(lines).toContain("stack");
		expect(lines.some((line) => line.includes("render-failure.test.ts"))).toBe(true);
		expect(lines.some((line) => line.includes("node:internal"))).toBe(false);
		expect(lines.at(-1)).toBe("Please report at https://github.com/spencerbeggs/vitest-agent/issues");
	});
});

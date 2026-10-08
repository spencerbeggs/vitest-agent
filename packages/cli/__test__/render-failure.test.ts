import type { FailureDetails } from "@effected/cli";
import { Cancelled, CliRuntime, NotInteractive } from "@effected/cli";
import { Cause, Data, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { renderFailure } from "../src/lib/render-failure.js";

class SqlError extends Data.TaggedError("SqlError")<{ readonly message: string }> {}

// `defaultLines` stands in for the run's painted report; renderFailure must never echo it (it leads with `[FAIL]`).
const DEFAULT_LINES = ["[FAIL] the run's own report"];

/**
 * A `FailureDetails` outside a run. `lines` is the kit's run-less equivalent,
 * `CliRuntime.defaultRender` (plain, absolute paths), which is what
 * `details.lines` renders for a plain agent run with the identity `displayPath`.
 */
const detailsOf = (error: unknown, cause: Cause.Cause<unknown>, isDefect: boolean): FailureDetails => ({
	cause,
	isDefect,
	isCancelled: error instanceof Cancelled,
	isNotInteractive: error instanceof NotInteractive,
	defaultLines: DEFAULT_LINES,
	lines: (options) => {
		const rendered = CliRuntime.defaultRender(error, { cause, isDefect }, options);
		return typeof rendered === "string" ? rendered.split("\n") : rendered;
	},
});
const typed = (error: unknown) => renderFailure(error, detailsOf(error, Cause.fail(error), false));
const defect = (error: unknown) => renderFailure(error, detailsOf(error, Cause.die(error), true));

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
		const error = Cause.squash(exit.cause);
		const lines = renderFailure(error, detailsOf(error, exit.cause, false));

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

	it("never asks for an issue report when a Cancelled arrives as a defect", () => {
		expect(defect(Cancelled.make({ reason: "interrupt" }))).toEqual(["vitest-agent: cancelled; nothing written"]);
	});

	it("renders a defect as the kit's cleaned stack followed by the issue link", () => {
		const lines = defect(new Error("boom"));

		expect(lines[0]).toMatch(/^vitest-agent: .*Error: boom$/);
		expect(lines).toContain("stack");
		expect(lines.some((line) => line.includes("render-failure.test.ts"))).toBe(true);
		expect(lines.some((line) => line.includes("node:internal"))).toBe(false);
		expect(lines.at(-1)).toBe("Please report at https://github.com/spencerbeggs/vitest-agent/issues");
	});

	it("delegates to the run's report without its status, then prefixes its first line", () => {
		const calls: Array<boolean | undefined> = [];
		const details: FailureDetails = {
			cause: Cause.die(new Error("boom")),
			isDefect: true,
			isCancelled: false,
			isNotInteractive: false,
			defaultLines: DEFAULT_LINES,
			lines: (options) => {
				calls.push(options?.status);
				return ["Error: boom (painted, relative paths)", "stack", "  at main (src/main.ts:1:1)"];
			},
		};

		expect(renderFailure(new Error("boom"), details)).toEqual([
			"vitest-agent: Error: boom (painted, relative paths)",
			"stack",
			"  at main (src/main.ts:1:1)",
			"Please report at https://github.com/spencerbeggs/vitest-agent/issues",
		]);
		expect(calls).toEqual([false]);
	});
});

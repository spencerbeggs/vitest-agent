import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { HistoryRecord, TestHistory, TestRun } from "../src/schemas/History.js";

describe("TestRun", () => {
	it("accepts valid run", () => {
		const input = { timestamp: "2026-03-21T00:00:00.000Z", state: "passed" };
		const result = Schema.decodeUnknownSync(TestRun)(input);
		expect(result).toEqual(input);
	});

	it("accepts failed state", () => {
		const input = { timestamp: "2026-03-21T00:00:00.000Z", state: "failed" };
		const result = Schema.decodeUnknownSync(TestRun)(input);
		expect(result).toEqual(input);
	});

	it("rejects invalid state", () => {
		expect(() =>
			Schema.decodeUnknownSync(TestRun)({
				timestamp: "2026-03-21T00:00:00.000Z",
				state: "skipped",
			}),
		).toThrow();
	});

	it("rejects missing timestamp", () => {
		expect(() => Schema.decodeUnknownSync(TestRun)({ state: "passed" })).toThrow();
	});
});

describe("TestHistory", () => {
	it("accepts valid history entry", () => {
		const input = {
			fullName: "Suite > test name",
			runs: [
				{ timestamp: "2026-03-21T00:00:00.000Z", state: "passed" },
				{ timestamp: "2026-03-20T00:00:00.000Z", state: "failed" },
			],
		};
		const result = Schema.decodeUnknownSync(TestHistory)(input);
		expect(result).toEqual(input);
	});

	it("accepts empty runs array", () => {
		const input = { fullName: "test", runs: [] };
		const result = Schema.decodeUnknownSync(TestHistory)(input);
		expect(result.runs).toEqual([]);
	});
});

describe("HistoryRecord", () => {
	it("accepts valid record", () => {
		const input = {
			project: "my-lib",
			updatedAt: "2026-03-21T00:00:00.000Z",
			tests: [
				{
					fullName: "Suite > test",
					runs: [{ timestamp: "2026-03-21T00:00:00.000Z", state: "passed" }],
				},
			],
		};
		const result = Schema.decodeUnknownSync(HistoryRecord)(input);
		expect(result).toEqual(input);
	});

	it("accepts empty tests array", () => {
		const input = {
			project: "default",
			updatedAt: "2026-03-21T00:00:00.000Z",
			tests: [],
		};
		const result = Schema.decodeUnknownSync(HistoryRecord)(input);
		expect(result.tests).toEqual([]);
	});

	it("rejects missing project", () => {
		expect(() =>
			Schema.decodeUnknownSync(HistoryRecord)({
				updatedAt: "2026-03-21T00:00:00.000Z",
				tests: [],
			}),
		).toThrow();
	});
});

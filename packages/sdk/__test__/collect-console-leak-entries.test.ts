import type { ConsoleLeakTask } from "@vitest-agent/sdk";
import { collectConsoleLeakEntries } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";

describe("collectConsoleLeakEntries", () => {
	it("returns an empty array for files with no logs", () => {
		const files: ConsoleLeakTask[] = [{ type: "suite", name: "a.test.ts", tasks: [{ type: "test", name: "t" }] }];
		expect(collectConsoleLeakEntries(files)).toEqual([]);
	});

	it("attributes a file-level log to the file with no test", () => {
		const files: ConsoleLeakTask[] = [
			{ type: "suite", name: "a.test.ts", logs: [{ type: "stdout", content: "setup log" }], tasks: [] },
		];
		expect(collectConsoleLeakEntries(files)).toEqual([{ file: "a.test.ts", type: "stdout", content: "setup log" }]);
	});

	it("attributes a test-level log to the file + test fullTestName", () => {
		const files: ConsoleLeakTask[] = [
			{
				type: "suite",
				name: "a.test.ts",
				tasks: [
					{
						type: "test",
						name: "leaks",
						fullTestName: "group > leaks",
						logs: [{ type: "stderr", content: "boom" }],
					},
				],
			},
		];
		expect(collectConsoleLeakEntries(files)).toEqual([
			{ file: "a.test.ts", test: "group > leaks", type: "stderr", content: "boom" },
		]);
	});

	it("recurses through nested suites and preserves order", () => {
		const files: ConsoleLeakTask[] = [
			{
				type: "suite",
				name: "a.test.ts",
				logs: [{ type: "stdout", content: "file-1" }],
				tasks: [
					{
						type: "suite",
						name: "inner",
						tasks: [
							{ type: "test", name: "t1", fullTestName: "inner > t1", logs: [{ type: "stdout", content: "test-1" }] },
						],
					},
				],
			},
		];
		expect(collectConsoleLeakEntries(files)).toEqual([
			{ file: "a.test.ts", type: "stdout", content: "file-1" },
			{ file: "a.test.ts", test: "inner > t1", type: "stdout", content: "test-1" },
		]);
	});

	it("falls back to the test name when fullTestName is absent", () => {
		const files: ConsoleLeakTask[] = [
			{
				type: "suite",
				name: "a.test.ts",
				tasks: [{ type: "test", name: "bare", logs: [{ type: "stdout", content: "x" }] }],
			},
		];
		expect(collectConsoleLeakEntries(files)[0]?.test).toBe("bare");
	});

	describe("failed attribution", () => {
		it("marks an entry logged inside a failed test as failed: true", () => {
			const files: ConsoleLeakTask[] = [
				{
					type: "suite",
					name: "a.test.ts",
					tasks: [
						{
							type: "test",
							name: "boom",
							result: { state: "fail" },
							logs: [{ type: "stderr", content: "assertion failed" }],
						},
					],
				},
			];
			expect(collectConsoleLeakEntries(files)[0]?.failed).toBe(true);
		});

		it("does not mark an entry logged inside a passing test as failed", () => {
			const files: ConsoleLeakTask[] = [
				{
					type: "suite",
					name: "a.test.ts",
					tasks: [
						{
							type: "test",
							name: "ok",
							result: { state: "pass" },
							logs: [{ type: "stdout", content: "debug" }],
						},
					],
				},
			];
			expect(collectConsoleLeakEntries(files)[0]?.failed).toBeUndefined();
		});

		it("propagates a failed test's state to logs on nested descendant tasks", () => {
			const files: ConsoleLeakTask[] = [
				{
					type: "suite",
					name: "a.test.ts",
					tasks: [
						{
							type: "test",
							name: "boom",
							result: { state: "fail" },
							tasks: [{ logs: [{ type: "stdout", content: "nested" }] }],
						},
					],
				},
			];
			expect(collectConsoleLeakEntries(files)[0]?.failed).toBe(true);
		});

		it("does not mark a file-level log (no owning test) as failed when the file itself did not fail to load", () => {
			const files: ConsoleLeakTask[] = [
				{ type: "suite", name: "a.test.ts", logs: [{ type: "stdout", content: "setup log" }], tasks: [] },
			];
			expect(collectConsoleLeakEntries(files)[0]?.failed).toBeUndefined();
		});

		it("marks a file-level log as failed when the module itself failed to load", () => {
			const files: ConsoleLeakTask[] = [
				{
					type: "suite",
					name: "a.test.ts",
					result: { state: "fail" },
					logs: [{ type: "stdout", content: "collection error" }],
					tasks: [],
				},
			];
			expect(collectConsoleLeakEntries(files)[0]?.failed).toBe(true);
		});
	});
});

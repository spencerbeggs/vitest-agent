import { describe, expect, it } from "vitest";
import { isPartialRun } from "../src/utils/is-partial-run.js";

describe("isPartialRun", () => {
	it("returns false for a full run: no filenamePattern, matching spec counts, no projectFilter, no cliFilters", () => {
		const result = isPartialRun({
			filenamePattern: undefined,
			startedSpecCount: 10,
			totalSpecCount: 10,
			projectFilter: undefined,
			cliFilters: undefined,
			testNamePattern: undefined,
		});
		expect(result).toBe(false);
	});

	it("returns true when filenamePattern is a non-empty array", () => {
		const result = isPartialRun({
			filenamePattern: ["src/foo.test.ts"],
			startedSpecCount: 1,
			totalSpecCount: 10,
			projectFilter: undefined,
			cliFilters: undefined,
			testNamePattern: undefined,
		});
		expect(result).toBe(true);
	});

	it("returns true when startedSpecCount is less than totalSpecCount", () => {
		const result = isPartialRun({
			filenamePattern: undefined,
			startedSpecCount: 3,
			totalSpecCount: 10,
			projectFilter: undefined,
			cliFilters: undefined,
			testNamePattern: undefined,
		});
		expect(result).toBe(true);
	});

	it("returns true when projectFilter is set even if spec counts match", () => {
		const result = isPartialRun({
			filenamePattern: undefined,
			startedSpecCount: 10,
			totalSpecCount: 10,
			projectFilter: "sdk",
			cliFilters: undefined,
			testNamePattern: undefined,
		});
		expect(result).toBe(true);
	});

	describe("cliFilters (issue #401)", () => {
		it("returns false when cliFilters is an empty object and spec counts match", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: {},
				testNamePattern: undefined,
			});
			expect(result).toBe(false);
		});

		it("returns true when cliFilters.project is a non-empty array", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { project: ["@x/y"] },
				testNamePattern: undefined,
			});
			expect(result).toBe(true);
		});

		it("returns true when cliFilters.project is a non-empty string", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { project: "@x/y" },
				testNamePattern: undefined,
			});
			expect(result).toBe(true);
		});

		it("returns false when cliFilters.project is an empty array", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { project: [] },
				testNamePattern: undefined,
			});
			expect(result).toBe(false);
		});

		it("returns true when cliFilters.tagsFilter is a non-empty array", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { tagsFilter: ["int"] },
				testNamePattern: undefined,
			});
			expect(result).toBe(true);
		});

		it("returns false when cliFilters.tagsFilter is an empty array", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { tagsFilter: [] },
				testNamePattern: undefined,
			});
			expect(result).toBe(false);
		});

		it("returns true when cliFilters.changed is true", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { changed: true },
				testNamePattern: undefined,
			});
			expect(result).toBe(true);
		});

		it("returns true when cliFilters.changed is a ref string", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { changed: "main" },
				testNamePattern: undefined,
			});
			expect(result).toBe(true);
		});

		it("returns false when cliFilters.changed is false", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { changed: false },
				testNamePattern: undefined,
			});
			expect(result).toBe(false);
		});

		it("returns true when cliFilters.related is a non-empty array", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { related: ["src/foo.ts"] },
				testNamePattern: undefined,
			});
			expect(result).toBe(true);
		});

		it("returns true when cliFilters.related is a non-empty string", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { related: "src/foo.ts" },
				testNamePattern: undefined,
			});
			expect(result).toBe(true);
		});

		it("returns false when cliFilters.related is an empty array", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { related: [] },
				testNamePattern: undefined,
			});
			expect(result).toBe(false);
		});

		it("returns true when cliFilters.shard is set", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: { shard: "1/3" },
				testNamePattern: undefined,
			});
			expect(result).toBe(true);
		});
	});

	describe("testNamePattern snapshot-diff rule (issue #401 regression fix)", () => {
		it("returns true when cli is truthy and initial equals current by stable key (CLI -t foo)", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: undefined,
				testNamePattern: { cli: "foo", initial: /foo/, current: /foo/ },
			});
			expect(result).toBe(true);
		});

		it("returns false when cli is an empty string and initial/current are both undefined", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: undefined,
				testNamePattern: { cli: "", initial: undefined, current: undefined },
			});
			expect(result).toBe(false);
		});

		it("returns false when cli is undefined and initial/current are distinct RegExp objects with the same source (config-file-only pattern)", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: undefined,
				testNamePattern: { cli: undefined, initial: /alpha/, current: /alpha/ },
			});
			expect(result).toBe(false);
		});

		it("returns true when current differs from initial and current is truthy (watch-mode filter applied)", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: undefined,
				testNamePattern: { cli: undefined, initial: undefined, current: /bar/ },
			});
			expect(result).toBe(true);
		});

		it("returns false when current differs from initial and current is falsy, even if cli is truthy (watch-mode filter cleared)", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: undefined,
				testNamePattern: { cli: "foo", initial: /foo/, current: undefined },
			});
			expect(result).toBe(false);
		});

		it("returns false when the whole testNamePattern object is undefined", () => {
			const result = isPartialRun({
				filenamePattern: undefined,
				startedSpecCount: 10,
				totalSpecCount: 10,
				projectFilter: undefined,
				cliFilters: undefined,
				testNamePattern: undefined,
			});
			expect(result).toBe(false);
		});
	});
});

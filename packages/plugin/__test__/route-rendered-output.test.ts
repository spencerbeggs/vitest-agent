/**
 * Routing tests for `routeRenderedOutput`'s `report` target — the
 * `.vitest/<scope>` writes introduced alongside Vitest 5's `createReport`.
 */

import { describe, expect, it, vi } from "vitest";
import { routeRenderedOutput } from "../src/utils/route-rendered-output.js";

describe("routeRenderedOutput report target", () => {
	it("forwards filename and content to writeReport", () => {
		const calls: Array<[string, string]> = [];
		routeRenderedOutput(
			{ target: "report", filename: "run.json", content: '{"a":1}', contentType: "application/json" },
			{ writeReport: (filename, content) => calls.push([filename, content]) },
		);
		expect(calls).toEqual([["run.json", '{"a":1}']]);
	});

	it("drops the output when no writeReport is supplied", () => {
		expect(() =>
			routeRenderedOutput(
				{ target: "report", filename: "run.json", content: "{}", contentType: "application/json" },
				{},
			),
		).not.toThrow();
	});

	it("does not route a report output to the github-summary file", () => {
		const calls: Array<[string, string]> = [];
		routeRenderedOutput(
			{ target: "report", filename: "run.json", content: "{}", contentType: "application/json" },
			{ githubSummaryFile: "/nonexistent/dir/summary.md", writeReport: (f, c) => calls.push([f, c]) },
		);
		expect(calls).toEqual([["run.json", "{}"]]);
	});

	it("contains a throwing writeReport so later outputs are still routed", () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			const outputs = [
				{ target: "report", filename: "run.json", content: "{}", contentType: "application/json" },
				{ target: "stdout", content: "after", contentType: "text/plain" },
			] as const;
			const routeAll = () => {
				for (const output of outputs) {
					routeRenderedOutput(output, {
						writeReport: () => {
							throw new Error("boom");
						},
					});
				}
			};
			expect(routeAll).not.toThrow();
			expect(stdout).toHaveBeenCalledWith("after\n");
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining("run.json"));
		} finally {
			stderr.mockRestore();
			stdout.mockRestore();
		}
	});
});

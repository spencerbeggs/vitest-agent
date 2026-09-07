/**
 * Routing tests for `routeRenderedOutput`'s `report` target — the
 * `.vitest/<scope>` writes introduced alongside Vitest 5's `createReport`.
 */

import { describe, expect, it } from "vitest";
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
});

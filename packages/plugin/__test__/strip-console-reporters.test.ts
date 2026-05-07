import { describe, expect, it } from "vitest";
import { stripConsoleReporters } from "../src/utils/strip-console-reporters.js";

describe("stripConsoleReporters", () => {
	it("removes built-in console reporters by string name", () => {
		const result = stripConsoleReporters(["default", "verbose", "json"]);
		expect(result).toEqual(["json"]);
	});

	it("removes tuple-style console reporters", () => {
		const result = stripConsoleReporters([
			["default", {}],
			["json", { outputFile: "out.json" }],
		]);
		expect(result).toEqual([["json", { outputFile: "out.json" }]]);
	});

	it("keeps custom reporter instances", () => {
		const custom = { onInit() {} };
		const result = stripConsoleReporters(["default", custom]);
		expect(result).toEqual([custom]);
	});

	it("removes all known console reporters", () => {
		const consoleNames = ["default", "verbose", "tree", "dot", "tap", "tap-flat", "hanging-process", "agent"];
		const result = stripConsoleReporters([...consoleNames, "json", "junit"]);
		expect(result).toEqual(["json", "junit"]);
	});

	it("keeps non-console built-in reporters", () => {
		const result = stripConsoleReporters(["json", "junit", "html", "blob", "github-actions"]);
		expect(result).toEqual(["json", "junit", "html", "blob", "github-actions"]);
	});

	it("returns empty array when all are console reporters", () => {
		const result = stripConsoleReporters(["default"]);
		expect(result).toEqual([]);
	});
});

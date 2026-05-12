/**
 * vitest-agent-sdk
 *
 * Tests for Options schemas.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AgentPluginOptions, AgentReporterOptions, CoverageOptions, FormatterOptions } from "../src/schemas/Options.js";

describe("AgentReporterOptions", () => {
	it("decodes an empty object with all defaults", () => {
		const result = Schema.decodeUnknownSync(AgentReporterOptions)({});
		expect(result).toBeDefined();
	});

	it("decodes a fully specified object", () => {
		const input = {
			cacheDir: "/tmp/cache",
			consoleOutput: "full",
			omitPassingTests: false,
			coverageThresholds: { lines: 80 },
			coverageTargets: { lines: 90 },
			autoUpdate: true,
			coverageConsoleLimit: 5,
			includeBareZero: true,
			githubActions: true,
			githubSummaryFile: "/tmp/summary.md",
		};
		const result = Schema.decodeUnknownSync(AgentReporterOptions)(input);
		expect(result.cacheDir).toBe("/tmp/cache");
		expect(result.consoleOutput).toBe("full");
		expect(result.omitPassingTests).toBe(false);
		expect(result.coverageThresholds).toEqual({ lines: 80 });
		expect(result.coverageTargets).toEqual({ lines: 90 });
		expect(result.autoUpdate).toBe(true);
		expect(result.coverageConsoleLimit).toBe(5);
		expect(result.includeBareZero).toBe(true);
		expect(result.githubActions).toBe(true);
		expect(result.githubSummaryFile).toBe("/tmp/summary.md");
	});

	it("rejects invalid consoleOutput value", () => {
		expect(() => Schema.decodeUnknownSync(AgentReporterOptions)({ consoleOutput: "verbose" })).toThrow();
	});
});

describe("AgentReporterOptions format/detail/mode", () => {
	it("accepts format option", () => {
		const opts = Schema.decodeUnknownSync(AgentReporterOptions)({ format: "json" });
		expect(opts.format).toBe("json");
	});

	it("accepts detail option", () => {
		const opts = Schema.decodeUnknownSync(AgentReporterOptions)({ detail: "verbose" });
		expect(opts.detail).toBe("verbose");
	});

	it("accepts consoleMode option", () => {
		const opts = Schema.decodeUnknownSync(AgentReporterOptions)({ consoleMode: "agent" });
		expect(opts.consoleMode).toBe("agent");
	});

	it("accepts logLevel option", () => {
		const opts = Schema.decodeUnknownSync(AgentReporterOptions)({ logLevel: "Debug" });
		expect(opts.logLevel).toBe("Debug");
	});

	it("accepts logFile option", () => {
		const opts = Schema.decodeUnknownSync(AgentReporterOptions)({ logFile: "./debug.log" });
		expect(opts.logFile).toBe("./debug.log");
	});
});

describe("AgentPluginOptions", () => {
	it("decodes an empty object with all defaults", () => {
		const result = Schema.decodeUnknownSync(AgentPluginOptions)({});
		expect(result).toBeDefined();
	});

	it("decodes a fully specified object", () => {
		const input = {
			console: { human: "ink", agent: "agent", ci: "ci-annotations" },
			githubSummary: true,
			reporterOptions: {
				cacheDir: "/tmp/cache",
				omitPassingTests: true,
				coverageThresholds: { lines: 90 },
				coverageTargets: { lines: 95 },
				autoUpdate: false,
				coverageConsoleLimit: 3,
				includeBareZero: false,
				githubSummaryFile: "/tmp/summary.md",
			},
		};
		const result = Schema.decodeUnknownSync(AgentPluginOptions)(input);
		expect(result.console?.human).toBe("ink");
		expect(result.console?.agent).toBe("agent");
		expect(result.console?.ci).toBe("ci-annotations");
		expect(result.githubSummary).toBe(true);
		expect(result.reporterOptions?.cacheDir).toBe("/tmp/cache");
	});

	it("rejects an invalid human console value", () => {
		expect(() => Schema.decodeUnknownSync(AgentPluginOptions)({ console: { human: "manual" } })).toThrow();
	});

	it("rejects ink in the agent slot (humans only)", () => {
		expect(() => Schema.decodeUnknownSync(AgentPluginOptions)({ console: { agent: "ink" } })).toThrow();
	});

	it("rejects ci-annotations in the human slot", () => {
		expect(() => Schema.decodeUnknownSync(AgentPluginOptions)({ console: { human: "ci-annotations" } })).toThrow();
	});
});

describe("CoverageOptions", () => {
	it("decodes a valid object", () => {
		const result = Schema.decodeUnknownSync(CoverageOptions)({
			thresholds: { lines: 80 },
			includeBareZero: false,
			coverageConsoleLimit: 10,
		});
		expect(result.thresholds).toEqual({ lines: 80 });
		expect(result.includeBareZero).toBe(false);
		expect(result.coverageConsoleLimit).toBe(10);
	});

	it("rejects missing required fields", () => {
		expect(() => Schema.decodeUnknownSync(CoverageOptions)({})).toThrow();
		expect(() => Schema.decodeUnknownSync(CoverageOptions)({ thresholds: { lines: 80 } })).toThrow();
	});
});

describe("FormatterOptions", () => {
	it("decodes a valid object", () => {
		const result = Schema.decodeUnknownSync(FormatterOptions)({
			consoleOutput: "failures",
			coverageConsoleLimit: 10,
			noColor: true,
			cacheFile: "/tmp/report.json",
		});
		expect(result.consoleOutput).toBe("failures");
		expect(result.coverageConsoleLimit).toBe(10);
		expect(result.noColor).toBe(true);
		expect(result.cacheFile).toBe("/tmp/report.json");
	});

	it("rejects missing required fields", () => {
		expect(() => Schema.decodeUnknownSync(FormatterOptions)({})).toThrow();
	});

	it("rejects invalid consoleOutput value", () => {
		expect(() =>
			Schema.decodeUnknownSync(FormatterOptions)({
				consoleOutput: "verbose",
				coverageConsoleLimit: 10,
				noColor: true,
				cacheFile: "/tmp/report.json",
			}),
		).toThrow();
	});
});

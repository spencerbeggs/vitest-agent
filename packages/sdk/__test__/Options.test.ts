/**
 * Schema decode tests for the 2.0 AgentPluginOptions / AgentReporterOptions
 * surface.
 *
 * Locked shape: AgentPluginOptions = { console?, coverageTargets?,
 * transport? } (function-typed `reporter` and `onRunEvent` live on the
 * companion `AgentPluginConstructorOptions` interface, not on the schema).
 * AgentReporterOptions = { projectFilter? }.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AgentPluginOptions, AgentReporterOptions } from "../src/schemas/Options.js";

describe("AgentPluginOptions decode", () => {
	it("decodes an empty object (all fields optional)", () => {
		const result = Schema.decodeUnknownSync(AgentPluginOptions)({});
		expect(result).toBeDefined();
	});

	it("decodes a fully-specified object with all three schema-decodable fields", () => {
		const result = Schema.decodeUnknownSync(AgentPluginOptions)({
			console: { human: "ink", agent: "agent", ci: "passthrough" },
			coverageTargets: { lines: 80, functions: 75 },
			transport: { kind: "local" },
		});
		expect(result.console?.human).toBe("ink");
		expect(result.coverageTargets?.lines).toBe(80);
		expect(result.transport?.kind).toBe("local");
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

	it("rejects negative numbers in coverageTargets", () => {
		expect(() => Schema.decodeUnknownSync(AgentPluginOptions)({ coverageTargets: { lines: -5 } })).toThrow();
	});

	it("rejects zero in coverageTargets (positive numbers only)", () => {
		expect(() => Schema.decodeUnknownSync(AgentPluginOptions)({ coverageTargets: { lines: 0 } })).toThrow();
	});

	it("rejects `true` shortcut at a non-100 key in coverageTargets", () => {
		expect(() => Schema.decodeUnknownSync(AgentPluginOptions)({ coverageTargets: { statements: true } })).toThrow();
	});

	it("accepts the `100: true` shortcut at key 100", () => {
		const result = Schema.decodeUnknownSync(AgentPluginOptions)({ coverageTargets: { 100: true } });
		expect(result.coverageTargets?.[100]).toBe(true);
	});

	it("accepts a glob-pattern entry in coverageTargets", () => {
		const result = Schema.decodeUnknownSync(AgentPluginOptions)({
			coverageTargets: { "src/utils/**": { lines: 90, branches: 85 } },
		});
		expect(result.coverageTargets?.["src/utils/**"]).toMatchObject({ lines: 90, branches: 85 });
	});

	it("accepts the local transport shape", () => {
		const result = Schema.decodeUnknownSync(AgentPluginOptions)({ transport: { kind: "local" } });
		expect(result.transport?.kind).toBe("local");
	});

	it("rejects a non-local transport kind (2.x only ships local)", () => {
		expect(() => Schema.decodeUnknownSync(AgentPluginOptions)({ transport: { kind: "d1" } as never })).toThrow();
	});
});

describe("AgentPluginOptions rejects every removed legacy field", () => {
	// The fields removed from AgentPluginOptions in 2.0. Each one must
	// trigger a ParseError on strict decode so future copy-paste from
	// old docs or training data surfaces as a build failure. The
	// `{ onExcessProperty: "error" }` decode option is the regression
	// safety net — under default decoding Effect Schema silently drops
	// unknown keys.
	const removed = [
		["coverageThresholds", { lines: 80 }],
		["autoUpdate", true],
		["consoleMode", "agent"],
		["consoleOutput", "failures"],
		["detail", "verbose"],
		["format", "json"],
		["mcp", true],
		["coverageConsoleLimit", 5],
		["omitPassingTests", false],
		["githubActions", true],
		["githubSummary", true],
		["githubSummaryFile", "/tmp/summary.md"],
		["reporterOptions", { cacheDir: "/tmp/cache" }],
		["logLevel", "Debug"],
		["logFile", "./debug.log"],
		["cacheDir", "/tmp/cache"],
		["includeBareZero", true],
	] as const;

	for (const [name, value] of removed) {
		it(`rejects legacy field ${name}`, () => {
			expect(() =>
				Schema.decodeUnknownSync(AgentPluginOptions)({ [name]: value }, { onExcessProperty: "error" }),
			).toThrow();
		});
	}
});

describe("AgentReporterOptions decode", () => {
	it("decodes an empty object", () => {
		const result = Schema.decodeUnknownSync(AgentReporterOptions)({});
		expect(result).toBeDefined();
	});

	it("decodes a projectFilter", () => {
		const result = Schema.decodeUnknownSync(AgentReporterOptions)({ projectFilter: "sdk" });
		expect(result.projectFilter).toBe("sdk");
	});

	it("rejects every removed legacy field", () => {
		const removed = [
			"cacheDir",
			"consoleOutput",
			"omitPassingTests",
			"coverageThresholds",
			"coverageTargets",
			"autoUpdate",
			"coverageConsoleLimit",
			"includeBareZero",
			"githubActions",
			"githubSummary",
			"githubSummaryFile",
			"format",
			"detail",
			"consoleMode",
			"logLevel",
			"logFile",
			"mcp",
		] as const;
		for (const name of removed) {
			expect(() =>
				Schema.decodeUnknownSync(AgentReporterOptions)({ [name]: "anything" }, { onExcessProperty: "error" }),
			).toThrow();
		}
	});
});

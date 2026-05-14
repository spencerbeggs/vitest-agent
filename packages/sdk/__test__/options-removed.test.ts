/**
 * Regression safety net for the 2.0 options cleanup.
 *
 * Two checks per removed legacy field:
 *
 * 1. Schema introspection — the field must not be a key on
 *    `AgentPluginOptions.fields` or `AgentReporterOptions.fields`. Catches
 *    re-additions to the schema directly.
 *
 * 2. Plugin-side `options.<name>` grep across `packages/plugin/src/` —
 *    catches consumer code that re-reads the removed field from a user
 *    constructor argument. Scoped to the plugin package because the
 *    same identifiers legitimately stay on `ResolvedReporterConfig`
 *    (the reporter-contract surface) and read paths like
 *    `kit.config.<name>` are valid 2.0 usage.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentPluginOptions, AgentReporterOptions } from "../src/schemas/Options.js";

const REMOVED_PLUGIN_OPTIONS = [
	"coverageThresholds",
	"autoUpdate",
	"consoleMode",
	"consoleOutput",
	"detail",
	"format",
	"mcp",
	"coverageConsoleLimit",
	"omitPassingTests",
	"githubActions",
	"githubSummary",
	"githubSummaryFile",
	"reporterOptions",
	"logLevel",
	"logFile",
	"cacheDir",
	"includeBareZero",
] as const;

const REMOVED_REPORTER_OPTIONS = [
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

describe("AgentPluginOptions schema does not carry removed fields", () => {
	const keys = new Set(Object.keys(AgentPluginOptions.fields));
	for (const name of REMOVED_PLUGIN_OPTIONS) {
		it(`AgentPluginOptions has no field ${name}`, () => {
			expect(keys.has(name)).toBe(false);
		});
	}
});

describe("AgentReporterOptions schema does not carry removed fields", () => {
	const keys = new Set(Object.keys(AgentReporterOptions.fields));
	for (const name of REMOVED_REPORTER_OPTIONS) {
		it(`AgentReporterOptions has no field ${name}`, () => {
			expect(keys.has(name)).toBe(false);
		});
	}
});

function stripCommentsAndStrings(source: string): string {
	// Strip block comments first (greedy, multiline), then line comments,
	// then string/template literals. Crude but adequate for grep guards.
	const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
	const noLine = noBlock.replace(/(^|[^:'"`])\/\/[^\n]*/g, "$1");
	const noTemplate = noLine.replace(/`(?:\\.|[^`\\])*`/g, "``");
	const noDouble = noTemplate.replace(/"(?:\\.|[^"\\])*"/g, '""');
	const noSingle = noDouble.replace(/'(?:\\.|[^'\\])*'/g, "''");
	return noSingle;
}

const PLUGIN_ENTRY = join(__dirname, "..", "..", "plugin", "src", "plugin.ts");

describe("AgentPlugin entry never reads options.<name> for a removed field", () => {
	// Scoped to plugin.ts because that file's `options` parameter is the
	// user-facing AgentPluginConstructorOptions argument. Internal modules
	// (`reporter.ts`, `build-reporter-kit.ts`) take plugin-resolved values
	// via their own constructor args — those reads are not user-input.
	const stripped = stripCommentsAndStrings(readFileSync(PLUGIN_ENTRY, "utf8"));

	for (const name of REMOVED_PLUGIN_OPTIONS) {
		it(`no options.${name} read in AgentPlugin entry`, () => {
			const pattern = new RegExp(`(?<![A-Za-z0-9_$])options\\??\\.${name}(?![A-Za-z0-9_$])`);
			expect(
				pattern.test(stripped),
				`packages/plugin/src/plugin.ts must not read options.${name} (it is a removed user option).`,
			).toBe(false);
		});
	}
});

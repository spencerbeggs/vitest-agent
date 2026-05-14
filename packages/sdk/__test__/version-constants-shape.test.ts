/**
 * T12 anti-regression — confirms that every package in the lockstep
 * group exports its CURRENT_<PKG>_VERSION constant typed as string. A
 * rename or removal of any constant must be intentional; this test
 * catches accidental drops.
 *
 * Each import resolves through the workspace at dist/dev/index.js so the
 * test sees the rslib-builder substitution result rather than the
 * source-time undefined value.
 */

import { describe, expect, it } from "vitest";
import { CURRENT_CLI_VERSION } from "../../cli/dist/dev/index.js";
import { CURRENT_MCP_VERSION } from "../../mcp/dist/dev/index.js";
import { CURRENT_PLUGIN_VERSION } from "../../plugin/dist/dev/index.js";
import { CURRENT_REPORTER_VERSION } from "../../reporter/dist/dev/index.js";
import { CURRENT_UI_VERSION } from "../../ui/dist/dev/index.js";
import { CURRENT_SDK_VERSION } from "../dist/dev/index.js";

const ALL_VERSIONS = {
	CURRENT_SDK_VERSION,
	CURRENT_PLUGIN_VERSION,
	CURRENT_REPORTER_VERSION,
	CURRENT_CLI_VERSION,
	CURRENT_MCP_VERSION,
	CURRENT_UI_VERSION,
} as const;

describe("Cross-package version constants", () => {
	it("exports all six CURRENT_<PKG>_VERSION constants as non-empty strings", () => {
		for (const [name, value] of Object.entries(ALL_VERSIONS)) {
			expect(typeof value, name).toBe("string");
			expect(value.length, name).toBeGreaterThan(0);
		}
	});

	it("matches all six versions in lockstep (the release pipeline guarantees this)", () => {
		const values = Object.values(ALL_VERSIONS);
		const unique = new Set(values);
		expect(unique.size).toBe(1);
	});
});

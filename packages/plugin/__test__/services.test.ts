/**
 * vitest-agent-plugin
 *
 * Tests for Effect Context.Tag service definitions provided by the reporter
 * package (currently just CoverageAnalyzer; everything else is in shared).
 */

import { Context } from "effect";
import { describe, expect, it } from "vitest";
import { CoverageAnalyzer } from "../src/services/CoverageAnalyzer.js";

describe("Service tags", () => {
	it("CoverageAnalyzer is a valid Context.Tag", () => {
		expect(CoverageAnalyzer).toBeDefined();
		expect(Context.isTag(CoverageAnalyzer)).toBe(true);
	});
});

import { describe, expect, it } from "vitest";
import type { ModuleCacheStat } from "../src/schemas/ModuleCache.js";
import { formatModuleCacheLine } from "../src/utils/module-cache.js";

const stat = (overrides: Partial<ModuleCacheStat> = {}): ModuleCacheStat => ({
	enabled: true,
	transformMs: 1200,
	trackedMs: 60000,
	share: 0.02,
	modulesWritten: 14,
	...overrides,
});

describe("formatModuleCacheLine", () => {
	it("should render the on state, transform time with its share, and modules written", () => {
		// Given: a cache-on stat with 14 writes
		// When: formatting
		const line = formatModuleCacheLine(stat());
		// Then: the documented one-line shape
		expect(line).toBe("Module cache: on · transform 1.2s (2%) · 14 modules written");
	});

	it("should render off and omit the written count when it is unknown", () => {
		const line = formatModuleCacheLine(
			stat({ enabled: false, modulesWritten: undefined, transformMs: 250, share: 0.125 }),
		);
		expect(line).toBe("Module cache: off · transform 250ms (13%)");
	});

	it("should use the singular for one module written", () => {
		expect(formatModuleCacheLine(stat({ modulesWritten: 1 }))).toBe(
			"Module cache: on · transform 1.2s (2%) · 1 module written",
		);
	});

	it("should say no modules written when the cache is warm", () => {
		expect(formatModuleCacheLine(stat({ modulesWritten: 0 }))).toBe(
			"Module cache: on · transform 1.2s (2%) · 0 modules written",
		);
	});
});

/**
 * T12 cross-package drift wiring — guards rslib-builder's
 * __PACKAGE_VERSION__ substitution. The test imports from dist/dev so the
 * value compared against package.json#version is the literal that
 * downstream consumers see at runtime, not the undefined source-time read.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURRENT_SDK_VERSION } from "../dist/dev/index.js";

describe("CURRENT_SDK_VERSION", () => {
	it("equals the source package.json#version after rslib-builder substitution", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			readonly version: string;
		};
		expect(CURRENT_SDK_VERSION).toBe(pkg.version);
	});

	it("is a non-empty string", () => {
		expect(typeof CURRENT_SDK_VERSION).toBe("string");
		expect(CURRENT_SDK_VERSION.length).toBeGreaterThan(0);
	});
});

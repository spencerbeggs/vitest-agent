/**
 * T12 cross-package drift wiring — guards rslib-builder's
 * __PACKAGE_VERSION__ substitution for the CLI package.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURRENT_CLI_VERSION } from "../dist/dev/index.js";

describe("CURRENT_CLI_VERSION", () => {
	it("equals the source package.json#version after rslib-builder substitution", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			readonly version: string;
		};
		expect(CURRENT_CLI_VERSION).toBe(pkg.version);
	});

	it("is a non-empty string", () => {
		expect(typeof CURRENT_CLI_VERSION).toBe("string");
		expect(CURRENT_CLI_VERSION.length).toBeGreaterThan(0);
	});
});

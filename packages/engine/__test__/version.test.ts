import { describe, expect, it } from "vitest";
import { CURRENT_ENGINE_VERSION } from "../src/index.js";

describe("CURRENT_ENGINE_VERSION", () => {
	it("matches a semver-shaped string", () => {
		expect(CURRENT_ENGINE_VERSION).toMatch(/\d+\.\d+\.\d+/);
	});
});

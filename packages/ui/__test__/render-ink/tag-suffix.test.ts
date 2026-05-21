import { describe, expect, it } from "vitest";
import { formatTagSuffix } from "../../src/render-ink/tag-suffix.js";

describe("formatTagSuffix", () => {
	it("renders sorted tag:count pairs for two or more tags", () => {
		expect(formatTagSuffix({ unit: 955, int: 6 })).toBe("int:6  unit:955");
	});

	it("suppresses a single tag as noise", () => {
		expect(formatTagSuffix({ unit: 955 })).toBe("");
	});

	it("returns an empty string for no tags", () => {
		expect(formatTagSuffix(undefined)).toBe("");
		expect(formatTagSuffix({})).toBe("");
	});
});

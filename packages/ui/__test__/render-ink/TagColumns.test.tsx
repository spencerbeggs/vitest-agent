import { describe, expect, it } from "vitest";
import { TagColumns, tagUnion } from "../../src/render-ink/TagColumns.js";
import { renderInk } from "../utils/render-ink.js";

describe("tagUnion", () => {
	it("returns the sorted union of tag names across rows", () => {
		expect(tagUnion([{ unit: 5, int: 1 }, { e2e: 2 }])).toEqual(["e2e", "int", "unit"]);
	});

	it("collapses a single-tag union to empty (no signal)", () => {
		expect(tagUnion([{ unit: 5 }, { unit: 2 }])).toEqual([]);
	});

	it("returns empty for undefined or empty rows", () => {
		expect(tagUnion([undefined, {}])).toEqual([]);
		expect(tagUnion([])).toEqual([]);
	});
});

describe("TagColumns", () => {
	it("renders every tag in the union as a fixed-width cell, zeros included", () => {
		const { frame, cleanup } = renderInk(
			<TagColumns tags={["e2e", "int", "unit"]} counts={{ e2e: 25, unit: 37 }} />,
			80,
		);
		expect(frame).toBe("e2e:  25  int:   0  unit:  37");
		cleanup();
	});

	it("right-aligns a 4-digit count flush against the tag label", () => {
		const { frame, cleanup } = renderInk(<TagColumns tags={["unit"]} counts={{ unit: 1006 }} />, 80);
		expect(frame).toBe("unit:1006");
		cleanup();
	});

	it("renders nothing for an empty tag union", () => {
		const { frame, cleanup } = renderInk(<TagColumns tags={[]} counts={{ unit: 5 }} />, 80);
		expect(frame).toBe("");
		cleanup();
	});
});

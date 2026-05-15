/**
 * Unit tests for the pure `db query` output formatter.
 */

import { describe, expect, it } from "vitest";
import { formatDbQuery } from "../src/lib/format-db-query.js";

describe("formatDbQuery", () => {
	describe("table format", () => {
		it("should render (0 rows) for an empty result set", () => {
			expect(formatDbQuery([], "table")).toBe("(0 rows)");
		});

		it("should render column headers followed by one line per row", () => {
			const out = formatDbQuery([{ name: "alpha" }, { name: "beta" }], "table");
			const lines = out.split("\n");
			expect(lines[0]).toBe("name");
			expect(lines[1]).toBe("alpha");
			expect(lines[2]).toBe("beta");
		});

		it("should pad every cell to its column's widest value", () => {
			const out = formatDbQuery(
				[
					{ id: 1, label: "short" },
					{ id: 200, label: "x" },
				],
				"table",
			);
			const lines = out.split("\n");
			// Column "id" width is max(2, 1, 3) = 3; "label" width is max(5, 5, 1) = 5.
			expect(lines[0]).toBe("id   label");
			expect(lines[1]).toBe("1    short");
			expect(lines[2]).toBe("200  x");
		});

		it("should render NULL for null and undefined cell values", () => {
			const out = formatDbQuery([{ a: null, b: undefined }], "table");
			const lines = out.split("\n");
			expect(lines[0]).toBe("a     b");
			expect(lines[1]).toBe("NULL  NULL");
		});

		it("should stringify mixed-type columns", () => {
			const out = formatDbQuery([{ n: 42, s: "text", flag: 0 }], "table");
			const lines = out.split("\n");
			expect(lines[1]).toContain("42");
			expect(lines[1]).toContain("text");
			expect(lines[1]).toContain("0");
		});
	});

	describe("json format", () => {
		it("should render [] for an empty result set", () => {
			expect(formatDbQuery([], "json")).toBe("[]");
		});

		it("should render a JSON array of row objects keyed by column name", () => {
			const out = formatDbQuery([{ id: 1, name: "alpha" }], "json");
			expect(JSON.parse(out)).toEqual([{ id: 1, name: "alpha" }]);
		});

		it("should preserve null values in JSON output", () => {
			const out = formatDbQuery([{ a: null, b: "set" }], "json");
			expect(JSON.parse(out)).toEqual([{ a: null, b: "set" }]);
		});
	});
});

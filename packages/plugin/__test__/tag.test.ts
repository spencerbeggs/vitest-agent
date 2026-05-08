import { describe, expect, it } from "vitest";
import { Tag } from "../src/utils/tag.js";

describe("Tag", () => {
	it("Tag.make returns a Tag with name and empty definition by default", () => {
		const t = Tag.make("unit");
		expect(t.name).toBe("unit");
		expect(t.definition).toEqual({ name: "unit" });
	});

	it("Tag.make accepts options and merges them into definition", () => {
		const t = Tag.make("int", { description: "Integration", timeout: 60_000, retry: 1 });
		expect(t.name).toBe("int");
		expect(t.definition).toEqual({
			name: "int",
			description: "Integration",
			timeout: 60_000,
			retry: 1,
		});
	});

	it("Tag.make rejects reserved boolean operators", () => {
		expect(() => Tag.make("and")).toThrow(/reserved/i);
		expect(() => Tag.make("or")).toThrow(/reserved/i);
		expect(() => Tag.make("not")).toThrow(/reserved/i);
	});

	it("Tag.make rejects names containing forbidden characters or whitespace", () => {
		for (const bad of ["foo bar", "foo(bar)", "a&b", "a|b", "a!b", "a*b", "a b", ""]) {
			expect(() => Tag.make(bad)).toThrow(/invalid|reserved|empty/i);
		}
	});
});

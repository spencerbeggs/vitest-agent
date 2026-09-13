import { describe, expect, it } from "vitest";
import { basenamePosix, joinPosix, relativePosix, toPosix } from "../src/utils/posix-path.js";

describe("posix-path", () => {
	describe("toPosix", () => {
		it("turns every backslash into a forward slash", () => {
			expect(toPosix("C:\\repo\\src\\a.ts")).toBe("C:/repo/src/a.ts");
		});
		it("leaves posix input unchanged", () => {
			expect(toPosix("/a/b/c.ts")).toBe("/a/b/c.ts");
		});
	});

	describe("basenamePosix", () => {
		it("returns the last segment", () => {
			expect(basenamePosix("/a/b.ts")).toBe("b.ts");
		});
		it("ignores a trailing separator", () => {
			expect(basenamePosix("/a/b/")).toBe("b");
		});
		it("returns a bare name unchanged", () => {
			expect(basenamePosix("b.ts")).toBe("b.ts");
		});
		it("normalizes backslash input", () => {
			expect(basenamePosix("C:\\a\\b.ts")).toBe("b.ts");
		});
	});

	describe("joinPosix", () => {
		it("joins parts with a single separator", () => {
			expect(joinPosix("/a", "b", "c.ts")).toBe("/a/b/c.ts");
		});
		it("collapses duplicate separators at the seams", () => {
			expect(joinPosix("/a/", "/b/", "c.ts")).toBe("/a/b/c.ts");
		});
		it("skips empty parts", () => {
			expect(joinPosix("/a", "", "c.ts")).toBe("/a/c.ts");
			expect(joinPosix()).toBe("");
		});
		it("normalizes backslash input", () => {
			expect(joinPosix("C:\\a", "b\\c.ts")).toBe("C:/a/b/c.ts");
		});
	});

	describe("relativePosix", () => {
		it("strips the parent prefix", () => {
			expect(relativePosix("/a/b", "/a/b/c/d.ts")).toBe("c/d.ts");
		});
		it("tolerates a trailing separator on the parent", () => {
			expect(relativePosix("/a/b/", "/a/b/c.ts")).toBe("c.ts");
		});
		it("returns an empty string for the same path", () => {
			expect(relativePosix("/a/b", "/a/b")).toBe("");
		});
		it("returns the target unchanged when it is not under the parent", () => {
			expect(relativePosix("/a/b", "/x/y.ts")).toBe("/x/y.ts");
		});
		it("does not match on a partial segment", () => {
			expect(relativePosix("/a/b", "/a/bc/d.ts")).toBe("/a/bc/d.ts");
		});
		it("normalizes backslash input on both sides", () => {
			expect(relativePosix("C:\\a\\b", "C:\\a\\b\\c\\d.ts")).toBe("c/d.ts");
		});
	});
});

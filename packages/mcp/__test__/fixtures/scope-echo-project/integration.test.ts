import { expect, test } from "vitest";

test("int-tagged case", { tags: ["int"] }, () => {
	expect(2).toBe(2);
});

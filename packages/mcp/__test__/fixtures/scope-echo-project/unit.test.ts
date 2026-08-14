import { expect, test } from "vitest";

test("unit-tagged case", { tags: ["unit"] }, () => {
	expect(1).toBe(1);
});

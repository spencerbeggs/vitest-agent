import { expect, test } from "vitest";

test("leaks when fetching", () => {
	console.log("DEBUG cache miss for key abc");
	console.error("WARN deprecated path used");
	expect(1).toBe(1);
});

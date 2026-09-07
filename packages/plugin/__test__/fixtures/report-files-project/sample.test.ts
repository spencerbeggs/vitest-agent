import { expect, it } from "vitest";

it("records an annotation", async ({ annotate }) => {
	await annotate("fixture note", "issues");
	expect(1 + 1).toBe(2);
});

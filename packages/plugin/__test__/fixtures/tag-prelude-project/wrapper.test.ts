import type { TestContext } from "vitest";
import { describe, expect, it } from "vitest";

// Minimal replica of @effect/vitest's makeTester signature (name, self,
// timeout): the second argument is the test body, the third is a timeout
// number or a vitest options object passed through to the options slot.
// This is the exact shape issue #133's per-call injection corrupted.
const effectIt = (
	name: string,
	self: (ctx: TestContext) => void | Promise<void>,
	timeout?: number | Record<string, unknown>,
): void => {
	it(name, typeof timeout === "number" ? { timeout } : (timeout ?? {}), async (ctx) => {
		await self(ctx);
	});
};

it("plain native test", () => {
	expect(1 + 1).toBe(2);
});

effectIt("wrapper tester with (name, self, timeout) signature", () => {
	expect(2 + 2).toBe(4);
});

describe("nested group", () => {
	it("test inside describe", () => {
		expect(3 + 3).toBe(6);
	});
});

it(
	"native test with timeout as third argument",
	() => {
		expect(4 + 4).toBe(8);
	},
	500,
);

it("test with explicit user tags", { tags: ["custom"] }, () => {
	expect(5 + 5).toBe(10);
});

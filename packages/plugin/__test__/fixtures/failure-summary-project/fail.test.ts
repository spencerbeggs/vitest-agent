import { test } from "vitest";

test("throws like a worker-hostile call", () => {
	throw new TypeError("process.chdir() is not supported in workers");
});

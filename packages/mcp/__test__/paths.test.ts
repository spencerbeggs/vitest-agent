import { describe, expect, it } from "vitest";
import { resolveResourcePath } from "../src/resources/paths.js";

describe("resolveResourcePath", () => {
	const root = "/abs/vendor/vitest-docs";

	it("resolves a simple relative markdown path", () => {
		expect(resolveResourcePath(root, "api/mock")).toBe("/abs/vendor/vitest-docs/api/mock.md");
	});

	it("accepts paths that already include the .md extension", () => {
		expect(resolveResourcePath(root, "api/mock.md")).toBe("/abs/vendor/vitest-docs/api/mock.md");
	});

	it("rejects parent-directory traversal", () => {
		expect(() => resolveResourcePath(root, "../escape")).toThrow(/path escapes/i);
	});

	it("rejects encoded parent-directory traversal", () => {
		expect(() => resolveResourcePath(root, "api/../../escape")).toThrow(/path escapes/i);
	});

	it("rejects absolute paths", () => {
		expect(() => resolveResourcePath(root, "/etc/passwd")).toThrow(/absolute path/i);
	});

	it("rejects paths containing null bytes", () => {
		expect(() => resolveResourcePath(root, "api/mock\0.md")).toThrow(/null byte/i);
	});

	it("resolves the empty path to the root directory", () => {
		expect(resolveResourcePath(root, "")).toBe("/abs/vendor/vitest-docs");
	});
});

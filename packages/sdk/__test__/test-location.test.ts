import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyTestPath } from "../src/utils/test-location.js";

const ROOT = "/repo";
const WORKSPACES = [
	{ name: "vitest-agent", path: ROOT },
	{ name: "@vitest-agent/plugin", path: join(ROOT, "packages", "plugin") },
	{ name: "@vitest-agent/plugin-extra", path: join(ROOT, "packages", "plugin-extra") },
];

describe("classifyTestPath", () => {
	it("classifies a file under a workspace src/ as valid", () => {
		const result = classifyTestPath(WORKSPACES, join(ROOT, "packages", "plugin", "src", "foo.test.ts"));
		expect(result).toEqual({ verdict: "valid", workspace: "@vitest-agent/plugin", suggestedPath: null });
	});

	it("classifies a file directly under a workspace __test__/ as valid", () => {
		const result = classifyTestPath(WORKSPACES, join(ROOT, "packages", "plugin", "__test__", "foo.test.ts"));
		expect(result?.verdict).toBe("valid");
	});

	it("classifies a kind-nested __test__ file as valid", () => {
		const path = join(ROOT, "packages", "plugin", "__test__", "integration", "foo.int.test.ts");
		expect(classifyTestPath(WORKSPACES, path)?.verdict).toBe("valid");
	});

	it("classifies a test under a __test__ helper dir as excluded, not invalid", () => {
		const path = join(
			ROOT,
			"packages",
			"plugin",
			"__test__",
			"fixtures",
			"nested-test-dir-project",
			"lib",
			"scripts",
			"__test__",
			"sample.test.ts",
		);
		expect(classifyTestPath(WORKSPACES, path)?.verdict).toBe("excluded");
	});

	it("does not apply the helper-dir rule under src/", () => {
		const path = join(ROOT, "packages", "plugin", "src", "fixtures", "foo.test.ts");
		expect(classifyTestPath(WORKSPACES, path)?.verdict).toBe("valid");
	});

	it("classifies a nested non-src, non-__test__ path as invalid and suggests a location", () => {
		const path = join(ROOT, "lib", "scripts", "__test__", "generate-schema.test.ts");
		expect(classifyTestPath(WORKSPACES, path)).toEqual({
			verdict: "invalid",
			workspace: "vitest-agent",
			suggestedPath: join(ROOT, "__test__", "generate-schema.test.ts"),
		});
	});

	it("attributes a path to the deepest containing workspace", () => {
		const path = join(ROOT, "packages", "plugin", "__test__", "foo.test.ts");
		expect(classifyTestPath(WORKSPACES, path)?.workspace).toBe("@vitest-agent/plugin");
	});

	it("does not treat a sibling with a shared name prefix as containing", () => {
		const path = join(ROOT, "packages", "plugin-extra", "src", "foo.test.ts");
		expect(classifyTestPath(WORKSPACES, path)?.workspace).toBe("@vitest-agent/plugin-extra");
	});

	it("returns null when no workspace contains the path", () => {
		expect(classifyTestPath(WORKSPACES, "/elsewhere/foo.test.ts")).toBeNull();
	});
});

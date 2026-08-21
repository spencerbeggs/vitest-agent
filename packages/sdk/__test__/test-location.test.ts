import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	NON_DISCOVERABLE_DIRS,
	classifyTestPath,
	findOwningWorkspace,
	isTestFileName,
} from "../src/utils/test-location.js";

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

	it("classifies a helper-named dir one level under __test__/, not at the test root, as valid", () => {
		// __test__/unit/utils/ is the natural mirror of src/utils/ — only a helper
		// dir AT THE TEST ROOT (segments[1]) marks exclusion, not any depth.
		const path = join(ROOT, "packages", "plugin", "__test__", "unit", "utils", "probe.test.ts");
		expect(classifyTestPath(WORKSPACES, path)?.verdict).toBe("valid");
	});

	it("classifies nested __test__/unit/fixtures/ and __test__/unit/snapshots/ files as valid", () => {
		const fixturesPath = join(ROOT, "packages", "plugin", "__test__", "unit", "fixtures", "sample.test.ts");
		const snapshotsPath = join(ROOT, "packages", "plugin", "__test__", "unit", "snapshots", "sample.test.ts");
		expect(classifyTestPath(WORKSPACES, fixturesPath)?.verdict).toBe("valid");
		expect(classifyTestPath(WORKSPACES, snapshotsPath)?.verdict).toBe("valid");
	});

	it.each(["fixtures", "snapshots", "utils"])(
		"classifies a file directly under __test__/%s/ at the test root as excluded",
		(dir) => {
			const path = join(ROOT, "packages", "plugin", "__test__", dir, "helper.ts");
			expect(classifyTestPath(WORKSPACES, path)?.verdict).toBe("excluded");
		},
	);

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

	// ── boundaries discovery honors and the classifier must not contradict ──
	// A path under one of these directories is never walked by discovery, so the
	// rule has nothing to say about it. Rendering `invalid` there advised moving
	// an installed dependency's or a vendored checkout's file into this repo's
	// own __test__/ directory (issue #227 review).

	it("returns null, not a verdict, for a path with a node_modules segment", () => {
		const path = join(ROOT, "node_modules", ".pnpm", "style-to-js@1.1.21", "src", "index.test.ts");
		expect(classifyTestPath(WORKSPACES, path)).toBeNull();
	});

	it("returns null, not a verdict, for a path with a dist segment", () => {
		const path = join(ROOT, "packages", "plugin", "src", "dist", "foo.test.ts");
		expect(classifyTestPath(WORKSPACES, path)).toBeNull();
	});

	it("returns null, not a verdict, for a path with a .git segment", () => {
		expect(classifyTestPath(WORKSPACES, join(ROOT, ".git", "hooks", "foo.test.ts"))).toBeNull();
	});

	it("declines a verdict even when the non-discoverable dir sits under a valid root", () => {
		const path = join(ROOT, "packages", "plugin", "__test__", "node_modules", "dep", "foo.test.ts");
		expect(classifyTestPath(WORKSPACES, path)).toBeNull();
	});

	it("does not treat a name merely containing a skipped segment as skipped", () => {
		const path = join(ROOT, "packages", "plugin", "src", "node_modules_helper", "foo.test.ts");
		expect(classifyTestPath(WORKSPACES, path)?.verdict).toBe("valid");
	});
});

describe("NON_DISCOVERABLE_DIRS", () => {
	it("is the set both plugin walkers prune before recursing", () => {
		expect([...NON_DISCOVERABLE_DIRS].sort()).toEqual([".git", "dist", "node_modules"]);
	});
});

describe("findOwningWorkspace", () => {
	it("returns the deepest containing workspace", () => {
		const path = join(ROOT, "packages", "plugin", "__test__", "foo.test.ts");
		expect(findOwningWorkspace(WORKSPACES, path)?.path).toBe(join(ROOT, "packages", "plugin"));
	});

	it("returns null when no workspace contains the path", () => {
		expect(findOwningWorkspace(WORKSPACES, "/elsewhere/foo.test.ts")).toBeNull();
	});
});

describe("isTestFileName", () => {
	it.each(["foo.test.ts", "foo.test.tsx", "foo.spec.js", "foo.spec.jsx", "a/b/foo.unit.test.ts"])(
		"recognises %s",
		(name) => {
			expect(isTestFileName(name)).toBe(true);
		},
	);

	it.each(["foo.ts", "foo.test.mts", "foo.bats", "test.ts", "foo.test.ts.snap"])("rejects %s", (name) => {
		expect(isTestFileName(name)).toBe(false);
	});
});

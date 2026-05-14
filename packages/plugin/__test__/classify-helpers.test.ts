import { describe, expect, it } from "vitest";
import { classifyByDirectory, classifyByFilename, combineClassifiers } from "../src/utils/classify-helpers.js";
import type { ClassifyContext, ModuleInfo } from "../src/utils/discover-strategy.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeModuleInfo(filename: string, relativePath?: string): ModuleInfo {
	return {
		path: `/pkg/src/${filename}`,
		relativePath: relativePath ?? `src/${filename}`,
		filename,
		packageName: "@test/pkg",
		packagePath: "/pkg",
	};
}

function makeCtx(filename: string, relativePath?: string): ClassifyContext {
	return {
		module: makeModuleInfo(filename, relativePath),
		tags: [],
		inherited: [],
	};
}

// ── Goal 15, Behavior 24: classifyByFilename string key form ──────────────────

describe("classifyByFilename (string suffix map)", () => {
	it("should match exact suffix and return tags for .int.test.ts", () => {
		// Given: a classifier configured to match .int.test.ts
		const classify = classifyByFilename({ ".int.test.ts": ["int"] });

		// When: called with a matching filename
		const result = classify(makeCtx("foo.int.test.ts"));

		// Then: returns the configured tag array
		expect(result).toEqual(["int"]);
	});

	it("should return [] for a non-matching filename", () => {
		// Given: a classifier configured to match .int.test.ts
		const classify = classifyByFilename({ ".int.test.ts": ["int"] });

		// When: called with a non-matching filename
		const result = classify(makeCtx("foo.test.ts"));

		// Then: returns empty array
		expect(result).toEqual([]);
	});

	it("should match the correct key when multiple suffixes are configured", () => {
		// Given: a classifier with multiple suffix keys
		const classify = classifyByFilename({
			".e2e.test.ts": ["e2e"],
			".int.test.ts": ["int"],
		});

		// When: called with each matching filename
		const e2eResult = classify(makeCtx("bar.e2e.test.ts"));
		const intResult = classify(makeCtx("bar.int.test.ts"));
		const noMatchResult = classify(makeCtx("bar.test.ts"));

		// Then: each returns the matching tags, non-matching returns []
		expect(e2eResult).toEqual(["e2e"]);
		expect(intResult).toEqual(["int"]);
		expect(noMatchResult).toEqual([]);
	});
});

// ── Goal 15, Behavior 25: classifyByFilename RegExp tuple form ────────────────

describe("classifyByFilename (RegExp tuple array)", () => {
	it("should accept RegExp entries and match anywhere in the filename", () => {
		// Given: a classifier using RegExp tuples
		const classify = classifyByFilename([[/integration/, ["int"]]]);

		// When: called with a filename containing 'integration'
		const result = classify(makeCtx("my.integration.test.ts"));

		// Then: returns the configured tags
		expect(result).toEqual(["int"]);
	});

	it("should return [] when no RegExp pattern matches", () => {
		// Given: a classifier using RegExp tuples
		const classify = classifyByFilename([[/integration/, ["int"]]]);

		// When: called with a filename that does not match
		const result = classify(makeCtx("foo.test.ts"));

		// Then: returns empty array
		expect(result).toEqual([]);
	});

	it("should return the first match when multiple patterns are configured", () => {
		// Given: two patterns where both could match
		const classify = classifyByFilename([
			[/\.e2e\./, ["e2e"]],
			[/\.int\./, ["int"]],
		]);

		// When: called with a filename matching the first pattern only
		const result = classify(makeCtx("foo.e2e.test.ts"));

		// Then: returns the first match's tags
		expect(result).toEqual(["e2e"]);
	});
});

// ── Goal 15, Behavior 26: classifyByDirectory ─────────────────────────────────

describe("classifyByDirectory", () => {
	it("should match a module whose relativePath starts with the segment", () => {
		// Given: a classifier keyed on "integration"
		const classify = classifyByDirectory({ integration: ["int"] });

		// When: relativePath starts with "integration/"
		const result = classify(makeCtx("foo.test.ts", "integration/foo.test.ts"));

		// Then: returns the configured tags
		expect(result).toEqual(["int"]);
	});

	it("should match a module whose relativePath contains the segment with slash boundaries", () => {
		// Given: a classifier keyed on "integration"
		const classify = classifyByDirectory({ integration: ["int"] });

		// When: relativePath contains "/integration/"
		const result = classify(makeCtx("foo.test.ts", "src/integration/foo.test.ts"));

		// Then: returns the configured tags
		expect(result).toEqual(["int"]);
	});

	it("should NOT match when segment appears only as a substring of a directory name", () => {
		// Given: a classifier keyed on "integration"
		const classify = classifyByDirectory({ integration: ["int"] });

		// When: relativePath has "my-integration-tests" (no slash boundary)
		const result = classify(makeCtx("foo.test.ts", "my-integration-tests/foo.test.ts"));

		// Then: returns empty array (no boundary match)
		expect(result).toEqual([]);
	});

	it("should return [] for a module with no matching directory segment", () => {
		// Given: a classifier keyed on "__test__/integration"
		const classify = classifyByDirectory({ "__test__/integration": ["int"] });

		// When: relativePath has __test__ but not the full segment
		const result = classify(makeCtx("foo.test.ts", "__test__/foo.test.ts"));

		// Then: returns empty array
		expect(result).toEqual([]);
	});

	it("should match a module whose relativePath exactly equals the segment key", () => {
		// Given: a classifier keyed on "src"
		const classify = classifyByDirectory({ src: ["unit"] });

		// When: relativePath exactly equals "src"
		const result = classify(makeCtx("foo.test.ts", "src"));

		// Then: returns the configured tags
		expect(result).toEqual(["unit"]);
	});

	it("should still match when relativePath uses backslash separators", () => {
		// Given: a classifier keyed on "integration" and a Windows-style
		// relativePath that a custom DiscoverStrategy might supply without
		// normalizing through toPosixPath first
		const classify = classifyByDirectory({ integration: ["int"] });

		// When: the backslash-bearing relativePath is classified
		const result = classify(makeCtx("foo.test.ts", "src\\integration\\sub"));

		// Then: the defensive normalization inside classifyByDirectory folds
		// the backslashes to forward slashes so the slash-bounded match still
		// fires — confirms the cross-platform invariant documented in the JSDoc
		expect(result).toEqual(["int"]);
	});
});

// ── Goal 15, Behavior 27: combineClassifiers ─────────────────────────────────

describe("combineClassifiers", () => {
	it("should return the union of multiple classifier results", () => {
		// Given: two classifiers returning different tags
		const classifyA = classifyByFilename({ ".int.test.ts": ["int"] });
		const classifyB = classifyByDirectory({ __test__: ["unit"] });
		const combined = combineClassifiers(classifyA, classifyB);

		// When: called with a context that matches both
		const result = combined(makeCtx("foo.int.test.ts", "__test__/foo.int.test.ts"));

		// Then: returns union of both
		expect(result).toEqual(["int", "unit"]);
	});

	it("should deduplicate tags by name (first occurrence wins)", () => {
		// Given: two classifiers that both return "unit"
		const classifyA = (_ctx: ClassifyContext) => ["unit"] as const;
		const classifyB = (_ctx: ClassifyContext) => ["unit", "extra"] as const;
		const combined = combineClassifiers(classifyA, classifyB);

		// When: called with any context
		const result = combined(makeCtx("foo.test.ts"));

		// Then: "unit" appears only once, "extra" is appended
		expect(result).toEqual(["unit", "extra"]);
	});

	it("should concatenate results in order across classifiers", () => {
		// Given: three classifiers returning distinct tags in order
		const a = (_ctx: ClassifyContext) => ["a"] as const;
		const b = (_ctx: ClassifyContext) => ["b"] as const;
		const c = (_ctx: ClassifyContext) => ["c"] as const;
		const combined = combineClassifiers(a, b, c);

		// When: called
		const result = combined(makeCtx("foo.test.ts"));

		// Then: tags appear in classifier order
		expect(result).toEqual(["a", "b", "c"]);
	});
});

// ── Goal 15, Behavior 28: combineClassifiers with no arguments ────────────────

describe("combineClassifiers (no arguments)", () => {
	it("should return empty array for any context when called with no classifiers", () => {
		// Given: no classifiers
		const combined = combineClassifiers();

		// When: called with any context
		const result = combined(makeCtx("foo.test.ts"));

		// Then: returns empty array
		expect(result).toEqual([]);
	});
});

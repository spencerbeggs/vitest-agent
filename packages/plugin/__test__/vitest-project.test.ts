import { cpus } from "node:os";
import { describe, expect, it } from "vitest";
import { VitestProject } from "../src/utils/vitest-project.js";

describe("VitestProject.unit()", () => {
	it("stores name and kind", () => {
		const p = VitestProject.unit({ name: "my-pkg", include: ["src/**/*.test.ts"] });
		expect(p.name).toBe("my-pkg");
		expect(p.kind).toBe("unit");
	});
	it("sets node environment by default", () => {
		const p = VitestProject.unit({ name: "x", include: [] });
		expect(p.toConfig().test?.environment).toBe("node");
	});
	it("puts name and include in toConfig()", () => {
		const p = VitestProject.unit({ name: "pkg", include: ["a/**"] });
		expect(p.toConfig().test?.name).toBe("pkg");
		expect(p.toConfig().test?.include).toEqual(["a/**"]);
	});
	it("merges overrides without clobbering name or include", () => {
		const p = VitestProject.unit({
			name: "pkg",
			include: ["src/**"],
			overrides: { test: { environment: "jsdom" } },
		});
		expect(p.toConfig().test?.name).toBe("pkg");
		expect(p.toConfig().test?.environment).toBe("jsdom");
	});
});

describe("VitestProject.int()", () => {
	it("sets kind to int", () => {
		expect(VitestProject.int({ name: "x:int", include: [] }).kind).toBe("int");
	});
	it("sets 60s testTimeout", () => {
		expect(VitestProject.int({ name: "x:int", include: [] }).toConfig().test?.testTimeout).toBe(60_000);
	});
	it("sets 30s hookTimeout", () => {
		expect(VitestProject.int({ name: "x:int", include: [] }).toConfig().test?.hookTimeout).toBe(30_000);
	});
	it("sets CPU-scaled maxConcurrency between 1 and 8", () => {
		const concurrency = VitestProject.int({ name: "x:int", include: [] }).toConfig().test?.maxConcurrency as number;
		expect(concurrency).toBeGreaterThanOrEqual(1);
		expect(concurrency).toBeLessThanOrEqual(8);
		expect(concurrency).toBe(Math.max(1, Math.min(8, Math.floor(cpus().length / 2))));
	});
});

describe("VitestProject.e2e()", () => {
	it("sets kind to e2e", () => {
		expect(VitestProject.e2e({ name: "x:e2e", include: [] }).kind).toBe("e2e");
	});
	it("sets 120s testTimeout", () => {
		expect(VitestProject.e2e({ name: "x:e2e", include: [] }).toConfig().test?.testTimeout).toBe(120_000);
	});
	it("sets 60s hookTimeout", () => {
		expect(VitestProject.e2e({ name: "x:e2e", include: [] }).toConfig().test?.hookTimeout).toBe(60_000);
	});
});

describe("VitestProject.custom()", () => {
	it("stores the provided kind string", () => {
		const p = VitestProject.custom("smoke", { name: "smoke", include: [] });
		expect(p.kind).toBe("smoke");
	});
	it("applies no preset defaults", () => {
		const cfg = VitestProject.custom("smoke", { name: "smoke", include: [] }).toConfig();
		expect(cfg.test?.testTimeout).toBeUndefined();
		expect(cfg.test?.environment).toBeUndefined();
	});
});

describe("VitestProject.override()", () => {
	it("merges test config while preserving name and include", () => {
		const p = VitestProject.unit({ name: "x", include: ["a/**"] }).override({ test: { environment: "jsdom" } });
		expect(p.toConfig().test?.name).toBe("x");
		expect(p.toConfig().test?.include).toEqual(["a/**"]);
		expect(p.toConfig().test?.environment).toBe("jsdom");
	});
	it("is chainable", () => {
		const p = VitestProject.unit({ name: "x", include: [] })
			.override({ test: { environment: "jsdom" } })
			.override({ test: { testTimeout: 5000 } });
		expect(p.toConfig().test?.environment).toBe("jsdom");
		expect(p.toConfig().test?.testTimeout).toBe(5000);
	});
});

describe("VitestProject.addInclude() / addExclude()", () => {
	it("appends include patterns", () => {
		const p = VitestProject.unit({ name: "x", include: ["src/**"] }).addInclude("extra/**");
		expect(p.toConfig().test?.include).toEqual(["src/**", "extra/**"]);
	});
	it("appends exclude patterns", () => {
		const p = VitestProject.unit({ name: "x", include: [] }).addExclude("**/*.e2e.*");
		expect(p.toConfig().test?.exclude).toContain("**/*.e2e.*");
	});
});

describe("VitestProject.addCoverageExclude()", () => {
	it("accumulates patterns on the coverageExcludes getter", () => {
		const p = VitestProject.unit({ name: "x", include: [] })
			.addCoverageExclude("src/generated/**")
			.addCoverageExclude("src/vendor/**");
		expect(p.coverageExcludes).toEqual(["src/generated/**", "src/vendor/**"]);
	});
});

describe("VitestProject.clone()", () => {
	it("creates an independent copy", () => {
		const original = VitestProject.unit({ name: "x", include: ["src/**"] });
		const clone = original.clone();
		clone.addInclude("extra/**");
		expect(original.toConfig().test?.include).toEqual(["src/**"]);
		expect(clone.toConfig().test?.include).toEqual(["src/**", "extra/**"]);
	});
	it("clone coverageExcludes are independent", () => {
		const original = VitestProject.unit({ name: "x", include: [] }).addCoverageExclude("a/**");
		const clone = original.clone();
		clone.addCoverageExclude("b/**");
		expect(original.coverageExcludes).toEqual(["a/**"]);
		expect(clone.coverageExcludes).toEqual(["a/**", "b/**"]);
	});
});

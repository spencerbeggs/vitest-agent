import { describe, expect, it } from "vitest";
import { resolveProjectDir } from "../src/project-dir.js";

describe("resolveProjectDir", () => {
	const cwd = "/work/cwd";

	it("prefers VITEST_AGENT_PROJECT_DIR over everything else", () => {
		const env = {
			VITEST_AGENT_PROJECT_DIR: "/a",
			VITEST_AGENT_REPORTER_PROJECT_DIR: "/b",
			CLAUDE_PROJECT_DIR: "/c",
		};
		expect(resolveProjectDir({ env, cwd })).toBe("/a");
	});

	it("falls back to VITEST_AGENT_REPORTER_PROJECT_DIR", () => {
		const env = { VITEST_AGENT_REPORTER_PROJECT_DIR: "/b", CLAUDE_PROJECT_DIR: "/c" };
		expect(resolveProjectDir({ env, cwd })).toBe("/b");
	});

	it("falls back to CLAUDE_PROJECT_DIR", () => {
		const env = { CLAUDE_PROJECT_DIR: "/c" };
		expect(resolveProjectDir({ env, cwd })).toBe("/c");
	});

	it("falls back to cwd when no env var is set", () => {
		expect(resolveProjectDir({ env: {}, cwd })).toBe(cwd);
	});

	it("treats empty strings as unset", () => {
		const env = { VITEST_AGENT_PROJECT_DIR: "", VITEST_AGENT_REPORTER_PROJECT_DIR: "", CLAUDE_PROJECT_DIR: "" };
		expect(resolveProjectDir({ env, cwd })).toBe(cwd);
		expect(resolveProjectDir({ env: { VITEST_AGENT_PROJECT_DIR: "", CLAUDE_PROJECT_DIR: "/c" }, cwd })).toBe("/c");
	});
});

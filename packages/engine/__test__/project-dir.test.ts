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

	it("treats a literal unsubstituted ${...} placeholder as unset", () => {
		const env = {
			VITEST_AGENT_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}",
			VITEST_AGENT_REPORTER_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}/pkg",
			CLAUDE_PROJECT_DIR: "/c",
		};
		expect(resolveProjectDir({ env, cwd })).toBe("/c");
		expect(resolveProjectDir({ env: { CLAUDE_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}" }, cwd })).toBe(cwd);
	});

	it("treats whitespace-only values as unset and trims the chosen value", () => {
		expect(resolveProjectDir({ env: { VITEST_AGENT_PROJECT_DIR: "   ", CLAUDE_PROJECT_DIR: " /c " }, cwd })).toBe("/c");
	});

	it("keeps a path that merely contains a dollar sign", () => {
		expect(resolveProjectDir({ env: { VITEST_AGENT_PROJECT_DIR: "/a/$b" }, cwd })).toBe("/a/$b");
	});
});

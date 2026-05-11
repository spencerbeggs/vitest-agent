import { describe, expect, it } from "vitest";
import { resolveProjectIdentityFromCandidates } from "../src/services/ProjectIdentity.js";

describe("resolveProjectIdentityFromCandidates", () => {
	it("returns null when no candidate has a value", () => {
		expect(resolveProjectIdentityFromCandidates({})).toBeNull();
	});

	describe("explicit option (priority 1)", () => {
		it("wins over every other source", () => {
			const result = resolveProjectIdentityFromCandidates({
				explicit: "explicit-key",
				toml: "toml-key",
				gitRemote: "git@github.com:foo/bar.git",
				packageJsonRepoUrl: "https://github.com/baz/qux",
				packageJsonName: "@org/pkg",
			});
			expect(result?.source).toBe("explicit");
			expect(result?.projectKey).toBe("explicit-key");
			expect(result?.canonicalForm).toBe("explicit-key");
		});

		it("normalizes filesystem-unsafe characters before returning", () => {
			const result = resolveProjectIdentityFromCandidates({ explicit: "@org/pkg" });
			expect(result?.projectKey).toBe("@org__pkg");
			expect(result?.canonicalForm).toBe("@org/pkg");
		});

		it("ignores empty string and falls through to next source", () => {
			const result = resolveProjectIdentityFromCandidates({
				explicit: "",
				toml: "from-toml",
			});
			expect(result?.source).toBe("toml");
			expect(result?.projectKey).toBe("from-toml");
		});
	});

	describe("TOML projectKey (priority 2)", () => {
		it("wins over git/package.json sources", () => {
			const result = resolveProjectIdentityFromCandidates({
				toml: "from-toml",
				gitRemote: "git@github.com:foo/bar.git",
				packageJsonRepoUrl: "https://github.com/baz/qux",
				packageJsonName: "@org/pkg",
			});
			expect(result?.source).toBe("toml");
			expect(result?.projectKey).toBe("from-toml");
		});

		it("normalizes the value the same way as explicit", () => {
			const result = resolveProjectIdentityFromCandidates({ toml: "@org/pkg" });
			expect(result?.projectKey).toBe("@org__pkg");
		});
	});

	describe("git remote (priority 3)", () => {
		it("wins over package.json sources", () => {
			const result = resolveProjectIdentityFromCandidates({
				gitRemote: "git@github.com:spencerbeggs/vitest-agent.git",
				packageJsonRepoUrl: "https://github.com/different/repo",
				packageJsonName: "different-name",
			});
			expect(result?.source).toBe("git-remote");
			expect(result?.projectKey).toBe("github.com__spencerbeggs__vitest-agent");
			expect(result?.canonicalForm).toBe("github.com/spencerbeggs/vitest-agent");
		});

		it("falls through to package.json when git URL is not canonicalizable", () => {
			const result = resolveProjectIdentityFromCandidates({
				gitRemote: "garbage",
				packageJsonName: "fallback",
			});
			expect(result?.source).toBe("package-name");
			expect(result?.projectKey).toBe("fallback");
		});
	});

	describe("package.json#repository.url (priority 4)", () => {
		it("wins over package.json#name", () => {
			const result = resolveProjectIdentityFromCandidates({
				packageJsonRepoUrl: "git+https://github.com/foo/bar.git",
				packageJsonName: "@org/pkg",
			});
			expect(result?.source).toBe("package-repository");
			expect(result?.projectKey).toBe("github.com__foo__bar");
			expect(result?.canonicalForm).toBe("github.com/foo/bar");
		});

		it("falls through to name when repository URL is not canonicalizable", () => {
			const result = resolveProjectIdentityFromCandidates({
				packageJsonRepoUrl: "not-a-url",
				packageJsonName: "fallback",
			});
			expect(result?.source).toBe("package-name");
			expect(result?.projectKey).toBe("fallback");
		});
	});

	describe("package.json#name (priority 5)", () => {
		it("normalizes scoped name to filesystem-safe form", () => {
			const result = resolveProjectIdentityFromCandidates({ packageJsonName: "@spencerbeggs/vitest-agent" });
			expect(result?.source).toBe("package-name");
			expect(result?.projectKey).toBe("@spencerbeggs__vitest-agent");
			expect(result?.canonicalForm).toBe("@spencerbeggs/vitest-agent");
		});
	});

	describe("cross-machine equivalence (success criteria)", () => {
		it("two clone protocols of the same repo hash to the same projectKey", () => {
			const ssh = resolveProjectIdentityFromCandidates({
				gitRemote: "git@github.com:spencerbeggs/vitest-agent.git",
			});
			const https = resolveProjectIdentityFromCandidates({
				gitRemote: "https://github.com/spencerbeggs/vitest-agent.git",
			});
			expect(ssh?.projectKey).toBe(https?.projectKey);
		});

		it("case variations on the canonical form hash the same", () => {
			const upper = resolveProjectIdentityFromCandidates({
				gitRemote: "https://GitHub.com/SpencerBeggs/Vitest-Agent",
			});
			const lower = resolveProjectIdentityFromCandidates({
				gitRemote: "https://github.com/spencerbeggs/vitest-agent",
			});
			expect(upper?.projectKey).toBe(lower?.projectKey);
		});
	});
});

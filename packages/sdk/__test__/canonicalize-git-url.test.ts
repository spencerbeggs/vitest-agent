import { describe, expect, it } from "vitest";
import { canonicalizeGitUrl, gitUrlToProjectKey } from "../src/utils/canonicalize-git-url.js";

describe("canonicalizeGitUrl", () => {
	it("canonicalizes SSH shorthand: user@host:path → host/path", () => {
		expect(canonicalizeGitUrl("git@github.com:spencerbeggs/vitest-agent.git")).toBe(
			"github.com/spencerbeggs/vitest-agent",
		);
	});

	it("strips https:// and trailing .git", () => {
		expect(canonicalizeGitUrl("https://github.com/spencerbeggs/vitest-agent.git")).toBe(
			"github.com/spencerbeggs/vitest-agent",
		);
	});

	it("strips https:// without .git suffix", () => {
		expect(canonicalizeGitUrl("https://github.com/spencerbeggs/vitest-agent")).toBe(
			"github.com/spencerbeggs/vitest-agent",
		);
	});

	it("strips ssh:// prefix and embedded user", () => {
		expect(canonicalizeGitUrl("ssh://git@github.com/spencerbeggs/vitest-agent.git")).toBe(
			"github.com/spencerbeggs/vitest-agent",
		);
	});

	it("lowercases host and path uniformly", () => {
		expect(canonicalizeGitUrl("https://GitHub.com/SpencerBeggs/Vitest-Agent")).toBe(
			"github.com/spencerbeggs/vitest-agent",
		);
	});

	it("strips git+https:// and git+ssh:// prefixes", () => {
		expect(canonicalizeGitUrl("git+https://github.com/foo/bar.git")).toBe("github.com/foo/bar");
		expect(canonicalizeGitUrl("git+ssh://git@github.com/foo/bar.git")).toBe("github.com/foo/bar");
	});

	it("strips http:// (not just https://)", () => {
		expect(canonicalizeGitUrl("http://example.com/foo/bar.git")).toBe("example.com/foo/bar");
	});

	it("strips trailing slash", () => {
		expect(canonicalizeGitUrl("https://github.com/foo/bar/")).toBe("github.com/foo/bar");
	});

	it("returns null for empty / whitespace input", () => {
		expect(canonicalizeGitUrl("")).toBeNull();
		expect(canonicalizeGitUrl("   ")).toBeNull();
	});

	it("returns null when input is missing both host and path", () => {
		expect(canonicalizeGitUrl("not-a-url")).toBeNull();
		expect(canonicalizeGitUrl("https://")).toBeNull();
	});

	it("is idempotent: canonical form re-canonicalizes to itself", () => {
		const out = canonicalizeGitUrl("https://github.com/foo/bar.git");
		if (out === null) throw new Error("expected canonicalization to succeed");
		expect(canonicalizeGitUrl(out)).toBe(out);
	});

	it("equates the four equivalent URL forms for the same repo", () => {
		const ssh = canonicalizeGitUrl("git@github.com:spencerbeggs/vitest-agent.git");
		const https = canonicalizeGitUrl("https://github.com/spencerbeggs/vitest-agent.git");
		const httpsNoExt = canonicalizeGitUrl("https://github.com/spencerbeggs/vitest-agent");
		const sshLong = canonicalizeGitUrl("ssh://git@github.com/spencerbeggs/vitest-agent.git");
		expect(ssh).toBe(https);
		expect(https).toBe(httpsNoExt);
		expect(httpsNoExt).toBe(sshLong);
	});
});

describe("gitUrlToProjectKey", () => {
	it("replaces slashes with double underscores for filesystem safety", () => {
		expect(gitUrlToProjectKey("github.com/spencerbeggs/vitest-agent")).toBe("github.com__spencerbeggs__vitest-agent");
	});

	it("returns null when canonicalization fails", () => {
		expect(gitUrlToProjectKey("")).toBeNull();
		expect(gitUrlToProjectKey("not-a-url")).toBeNull();
	});

	it("accepts a raw git URL (delegates to canonicalize first)", () => {
		expect(gitUrlToProjectKey("git@github.com:foo/bar.git")).toBe("github.com__foo__bar");
	});
});

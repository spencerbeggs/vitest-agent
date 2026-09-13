import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProjectKeyFromCwd } from "../src/utils/resolve-project-key-from-cwd.js";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "resolve-pk-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("resolveProjectKeyFromCwd", () => {
	it("prefers repository.url when present (string form)", () => {
		writeFileSync(
			join(cwd, "package.json"),
			JSON.stringify({ name: "my-app", repository: "git+https://github.com/foo/bar.git" }),
		);
		expect(resolveProjectKeyFromCwd(cwd)).toBe("github.com__foo__bar");
	});

	it("prefers repository.url when present (object form)", () => {
		writeFileSync(
			join(cwd, "package.json"),
			JSON.stringify({ name: "my-app", repository: { type: "git", url: "git@github.com:foo/bar.git" } }),
		);
		expect(resolveProjectKeyFromCwd(cwd)).toBe("github.com__foo__bar");
	});

	it("falls back to normalized name when repository.url is absent", () => {
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@scope/my-app" }));
		expect(resolveProjectKeyFromCwd(cwd)).toBe("@scope__my-app");
	});

	it("falls back to normalized name when repository.url is not canonicalizable", () => {
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "fallback-app", repository: "not-a-url" }));
		expect(resolveProjectKeyFromCwd(cwd)).toBe("fallback-app");
	});

	it("falls back to cwd basename when package.json is missing entirely", () => {
		expect(resolveProjectKeyFromCwd(cwd)).toBe(cwd.split("/").pop());
	});

	it("falls back to cwd basename when package.json is malformed", () => {
		writeFileSync(join(cwd, "package.json"), "{ this is not json");
		expect(resolveProjectKeyFromCwd(cwd)).toBe(cwd.split("/").pop());
	});

	it("walks upward to find the nearest package.json", () => {
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "outer-app" }));
		const inner = join(cwd, "src", "deep");
		mkdirSync(inner, { recursive: true });
		expect(resolveProjectKeyFromCwd(inner)).toBe("outer-app");
	});

	it("hashes SSH and HTTPS forms of the same git URL identically", () => {
		const sshDir = mkdtempSync(join(tmpdir(), "resolve-pk-ssh-"));
		const httpsDir = mkdtempSync(join(tmpdir(), "resolve-pk-https-"));
		writeFileSync(join(sshDir, "package.json"), JSON.stringify({ repository: "git@github.com:org/repo.git" }));
		writeFileSync(join(httpsDir, "package.json"), JSON.stringify({ repository: "https://github.com/org/repo.git" }));
		expect(resolveProjectKeyFromCwd(sshDir)).toBe(resolveProjectKeyFromCwd(httpsDir));
		rmSync(sshDir, { recursive: true, force: true });
		rmSync(httpsDir, { recursive: true, force: true });
	});
});

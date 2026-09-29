import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { resolveProjectKeyFromCwd, resolveProjectKeyFromCwdEffect } from "../src/utils/resolve-project-key-from-cwd.js";

/**
 * Every workspace sits under `/work` on a volume that has no `package.json`
 * above it, so the upward walk ends deterministically — unlike a real
 * tmpdir, whose ancestors are whatever the host happens to hold.
 */
const CWD = "/work/project";

const resolveOn = (seed: MemoryFileSystemSeed, cwd: string = CWD): Promise<string> =>
	Effect.runPromise(resolveProjectKeyFromCwdEffect(cwd).pipe(Effect.provide(MemoryFileSystem.layerWith(seed))));

const pkg = (body: unknown) => JSON.stringify(body);

describe("resolveProjectKeyFromCwdEffect", () => {
	it("prefers repository.url when present (string form)", async () => {
		const seed = {
			[`${CWD}/package.json`]: pkg({ name: "my-app", repository: "git+https://github.com/foo/bar.git" }),
		};
		expect(await resolveOn(seed)).toBe("github.com__foo__bar");
	});

	it("prefers repository.url when present (object form)", async () => {
		const seed = {
			[`${CWD}/package.json`]: pkg({ name: "my-app", repository: { type: "git", url: "git@github.com:foo/bar.git" } }),
		};
		expect(await resolveOn(seed)).toBe("github.com__foo__bar");
	});

	it("falls back to normalized name when repository.url is absent", async () => {
		expect(await resolveOn({ [`${CWD}/package.json`]: pkg({ name: "@scope/my-app" }) })).toBe("@scope__my-app");
	});

	it("falls back to normalized name when repository.url is not canonicalizable", async () => {
		const seed = { [`${CWD}/package.json`]: pkg({ name: "fallback-app", repository: "not-a-url" }) };
		expect(await resolveOn(seed)).toBe("fallback-app");
	});

	it("falls back to cwd basename when package.json is missing entirely", async () => {
		expect(await resolveOn({ [CWD]: MemoryFileSystem.directory() })).toBe("project");
	});

	it("falls back to cwd basename when package.json is malformed", async () => {
		expect(await resolveOn({ [`${CWD}/package.json`]: "{ this is not json" })).toBe("project");
	});

	it("walks upward to find the nearest package.json", async () => {
		const seed = {
			[`${CWD}/package.json`]: pkg({ name: "outer-app" }),
			[`${CWD}/src/deep`]: MemoryFileSystem.directory(),
		};
		expect(await resolveOn(seed, `${CWD}/src/deep`)).toBe("outer-app");
	});

	it("hashes SSH and HTTPS forms of the same git URL identically", async () => {
		const seed = {
			"/work/ssh/package.json": pkg({ repository: "git@github.com:org/repo.git" }),
			"/work/https/package.json": pkg({ repository: "https://github.com/org/repo.git" }),
		};
		const ssh = await resolveOn(seed, "/work/ssh");
		expect(ssh).toBe("github.com__org__repo");
		expect(await resolveOn(seed, "/work/https")).toBe(ssh);
	});
});

// Real-disk smoke for the synchronous `node:fs` form the CLI calls: the same
// rules, exercised once through the node default so the sync walk and read
// stay covered.
describe("resolveProjectKeyFromCwd (node:fs)", () => {
	it("walks upward on disk and prefers repository.url, then name, then basename", () => {
		const root = mkdtempSync(join(tmpdir(), "resolve-pk-"));
		try {
			const inner = join(root, "src", "deep");
			mkdirSync(inner, { recursive: true });
			writeFileSync(join(root, "package.json"), pkg({ name: "outer-app", repository: "git@github.com:foo/bar.git" }));
			expect(resolveProjectKeyFromCwd(inner)).toBe("github.com__foo__bar");

			writeFileSync(join(root, "package.json"), pkg({ name: "@scope/outer-app" }));
			expect(resolveProjectKeyFromCwd(inner)).toBe("@scope__outer-app");

			writeFileSync(join(root, "package.json"), "{ this is not json");
			expect(resolveProjectKeyFromCwd(inner)).toBe("deep");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

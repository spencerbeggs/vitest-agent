import { describe, expect, it } from "vitest";
import type { FileSystemAdapter } from "../src/utils/detect-pm.js";
import { detectPackageManager, getRunCommand } from "../src/utils/detect-pm.js";

// --- Helpers ---

function makeFs(files: Record<string, string>): FileSystemAdapter {
	return {
		async readFile(path: string): Promise<string> {
			if (path in files) return files[path];
			throw new Error(`ENOENT: ${path}`);
		},
		async exists(path: string): Promise<boolean> {
			return path in files;
		},
	};
}

// --- detectPackageManager ---

describe("detectPackageManager", () => {
	it("detects pnpm from packageManager field", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({ packageManager: "pnpm@10.32.1" }),
		});
		expect(await detectPackageManager("/root", fs)).toBe("pnpm");
	});

	it("detects npm from packageManager field", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({ packageManager: "npm@10.0.0" }),
		});
		expect(await detectPackageManager("/root", fs)).toBe("npm");
	});

	it("detects yarn from packageManager field", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({ packageManager: "yarn@4.1.0" }),
		});
		expect(await detectPackageManager("/root", fs)).toBe("yarn");
	});

	it("detects bun from packageManager field", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({ packageManager: "bun@1.1.0" }),
		});
		expect(await detectPackageManager("/root", fs)).toBe("bun");
	});

	it("detects pnpm from pnpm-lock.yaml when no packageManager field", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({}),
			"/root/pnpm-lock.yaml": "",
		});
		expect(await detectPackageManager("/root", fs)).toBe("pnpm");
	});

	it("detects npm from package-lock.json existence", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({}),
			"/root/package-lock.json": "",
		});
		expect(await detectPackageManager("/root", fs)).toBe("npm");
	});

	it("detects yarn from yarn.lock existence", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({}),
			"/root/yarn.lock": "",
		});
		expect(await detectPackageManager("/root", fs)).toBe("yarn");
	});

	it("detects bun from bun.lock existence", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({}),
			"/root/bun.lock": "",
		});
		expect(await detectPackageManager("/root", fs)).toBe("bun");
	});

	it("prefers packageManager field over lockfiles", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({ packageManager: "yarn@4.1.0" }),
			"/root/pnpm-lock.yaml": "",
		});
		expect(await detectPackageManager("/root", fs)).toBe("yarn");
	});

	it("returns null when package.json is missing and no lockfiles", async () => {
		const fs = makeFs({});
		expect(await detectPackageManager("/root", fs)).toBeNull();
	});

	it("returns null when package.json exists but no packageManager field and no lockfiles", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({ name: "my-pkg" }),
		});
		expect(await detectPackageManager("/root", fs)).toBeNull();
	});

	it("falls through to lockfile when packageManager value is unrecognized", async () => {
		const fs = makeFs({
			"/root/package.json": JSON.stringify({ packageManager: "deno@1.0.0" }),
			"/root/yarn.lock": "",
		});
		expect(await detectPackageManager("/root", fs)).toBe("yarn");
	});
});

// --- getRunCommand ---

describe("getRunCommand", () => {
	it('returns "pnpm vitest run" for pnpm', () => {
		expect(getRunCommand("pnpm")).toBe("pnpm vitest run");
	});

	it('returns "npx vitest run" for npm', () => {
		expect(getRunCommand("npm")).toBe("npx vitest run");
	});

	it('returns "yarn vitest run" for yarn', () => {
		expect(getRunCommand("yarn")).toBe("yarn vitest run");
	});

	it('returns "bun vitest run" for bun', () => {
		expect(getRunCommand("bun")).toBe("bun vitest run");
	});

	it('returns "npx vitest run" for null', () => {
		expect(getRunCommand(null)).toBe("npx vitest run");
	});
});

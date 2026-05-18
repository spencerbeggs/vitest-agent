// Tests for resolveSidecarBinaryPath — platform/arch binary path resolution
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveSidecarBinaryPath } from "../src/resolve-sidecar-binary-path.js";

// Fake resolver that simulates a successful require.resolve for the given package+binPath
function makeResolver(availablePackages: Map<string, string>) {
	return (packagePath: string): string => {
		if (availablePackages.has(packagePath)) {
			return availablePackages.get(packagePath)!;
		}
		const err = new Error(`Cannot find module '${packagePath}'`) as NodeJS.ErrnoException;
		err.code = "MODULE_NOT_FOUND";
		throw err;
	};
}

describe("resolveSidecarBinaryPath — supported platforms", () => {
	it("should return the resolved binary path for darwin-arm64", () => {
		// Given: a resolver that knows the darwin-arm64 package bin entry
		const resolver = makeResolver(
			new Map([["vitest-agent-sidecar-darwin-arm64/bin/vitest-agent-sidecar", "/abs/bin/vitest-agent-sidecar"]]),
		);

		// When: resolving on darwin/arm64
		const result = resolveSidecarBinaryPath({
			platform: "darwin",
			arch: "arm64",
			resolver,
		});

		// Then: returns the absolute path from the resolver
		expect(result).toBe("/abs/bin/vitest-agent-sidecar");
	});

	it("should return the resolved binary path for linux-arm64", () => {
		// Given: a resolver that knows the linux-arm64 package bin entry
		const resolver = makeResolver(
			new Map([["vitest-agent-sidecar-linux-arm64/bin/vitest-agent-sidecar", "/usr/local/bin/vitest-agent-sidecar"]]),
		);

		// When: resolving on linux/arm64
		const result = resolveSidecarBinaryPath({
			platform: "linux",
			arch: "arm64",
			resolver,
		});

		// Then: returns the absolute path
		expect(result).toBe("/usr/local/bin/vitest-agent-sidecar");
	});

	it("should return the resolved binary path for linux-x64", () => {
		// Given: a resolver that knows the linux-x64 package bin entry
		const resolver = makeResolver(
			new Map([["vitest-agent-sidecar-linux-x64/bin/vitest-agent-sidecar", "/opt/bin/vitest-agent-sidecar"]]),
		);

		// When: resolving on linux/x64
		const result = resolveSidecarBinaryPath({
			platform: "linux",
			arch: "x64",
			resolver,
		});

		// Then: returns the absolute path
		expect(result).toBe("/opt/bin/vitest-agent-sidecar");
	});

	it("should return the resolved binary path for win32-x64 (uses .exe extension)", () => {
		// Given: a resolver that knows the win32-x64 package bin entry (with .exe)
		const resolver = makeResolver(
			new Map([
				[
					"vitest-agent-sidecar-win32-x64/bin/vitest-agent-sidecar.exe",
					"C:\\Program Files\\bin\\vitest-agent-sidecar.exe",
				],
			]),
		);

		// When: resolving on win32/x64
		const result = resolveSidecarBinaryPath({
			platform: "win32",
			arch: "x64",
			resolver,
		});

		// Then: returns the absolute path (with .exe)
		expect(result).toBe("C:\\Program Files\\bin\\vitest-agent-sidecar.exe");
	});
});

describe("resolveSidecarBinaryPath — null cases", () => {
	it("should return null for darwin-x64 (no such package exists)", () => {
		// Given: a resolver that would fail for the non-existent darwin-x64 package
		const resolver = makeResolver(new Map());

		// When: resolving on darwin/x64 (no darwin-x64 package)
		const result = resolveSidecarBinaryPath({
			platform: "darwin",
			arch: "x64",
			resolver,
		});

		// Then: returns null (unsupported combination)
		expect(result).toBeNull();
	});

	it("should return null for win32-arm64 (no such package exists)", () => {
		// Given: a resolver that would fail for the non-existent win32-arm64 package
		const resolver = makeResolver(new Map());

		// When: resolving on win32/arm64 (no win32-arm64 package)
		const result = resolveSidecarBinaryPath({
			platform: "win32",
			arch: "arm64",
			resolver,
		});

		// Then: returns null (unsupported combination)
		expect(result).toBeNull();
	});

	it("should return null when resolver throws MODULE_NOT_FOUND for a supported platform", () => {
		// Given: a resolver that throws MODULE_NOT_FOUND (optional dep not installed)
		const resolver = makeResolver(new Map()); // empty — every resolve throws

		// When: resolving on darwin/arm64 but the optional dep is not installed
		const result = resolveSidecarBinaryPath({
			platform: "darwin",
			arch: "arm64",
			resolver,
		});

		// Then: returns null (optional dependency was skipped at install time)
		expect(result).toBeNull();
	});

	it("should re-throw errors that are not MODULE_NOT_FOUND", () => {
		// Given: a resolver that throws a non-MODULE_NOT_FOUND error
		const unexpectedError = new Error("EACCES: permission denied");
		const resolver = (_path: string): string => {
			throw unexpectedError;
		};

		// When/Then: the error propagates instead of returning null
		expect(() =>
			resolveSidecarBinaryPath({
				platform: "darwin",
				arch: "arm64",
				resolver,
			}),
		).toThrow(unexpectedError);
	});
});

describe("resolveSidecarBinaryPath — real default resolver (no injected resolver)", () => {
	it("should resolve real binary path without executing the binary when no resolver is injected", () => {
		// Given: the host is darwin-arm64 and the vitest-agent-sidecar-darwin-arm64
		// optional dependency is installed (it is a devDependency in this workspace).
		// No resolver is injected — the function must use its real default resolver.
		const isBinaryInstalled = existsSync(
			new URL("../node_modules/vitest-agent-sidecar-darwin-arm64/bin/vitest-agent-sidecar", import.meta.url).pathname,
		);

		if (!isBinaryInstalled) {
			// Binary not installed (e.g. CI cross-platform checkout) — skip gracefully.
			// The test still verifies that the function does not throw SyntaxError when
			// the binary is absent: MODULE_NOT_FOUND must return null, not crash.
			const result = resolveSidecarBinaryPath({ platform: "darwin", arch: "arm64" });
			expect(result).toBeNull();
			return;
		}

		// When: calling with NO injected resolver (exercises the real createRequire path)
		const result = resolveSidecarBinaryPath({ platform: "darwin", arch: "arm64" });

		// Then: must return a non-null string path — NOT throw SyntaxError from require().
		// The buggy code does createRequire(import.meta.url) which is require(), not
		// require.resolve(), so it executes the SEA binary as JS and throws SyntaxError.
		// The fix is createRequire(import.meta.url).resolve so it returns the path string.
		expect(typeof result).toBe("string");
		expect(result).not.toBeNull();
		// The resolved path must point to a file that actually exists on disk.
		expect(existsSync(result as string)).toBe(true);
	});
});

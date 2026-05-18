/**
 * vitest-agent-sidecar
 *
 * Resolves the absolute path of the platform-specific sidecar binary
 * by using `require.resolve` on the optional platform package's bin entry.
 *
 * @packageDocumentation
 */

import { createRequire } from "node:module";

/**
 * Platform and architecture resolver options for dependency injection in tests.
 */
export interface ResolveSidecarBinaryPathOptions {
	/** Override the platform (defaults to `process.platform`). */
	readonly platform?: NodeJS.Platform;
	/** Override the architecture (defaults to `process.arch`). */
	readonly arch?: string;
	/** Override the module resolver (defaults to `createRequire`-backed resolver). */
	readonly resolver?: (path: string) => string;
}

/**
 * The four platform/arch combinations that have a matching sidecar package.
 * darwin-x64 is intentionally absent — there is no such package.
 */
const SUPPORTED_PLATFORMS: ReadonlyMap<string, string> = new Map([
	["darwin-arm64", "vitest-agent-sidecar-darwin-arm64"],
	["linux-arm64", "vitest-agent-sidecar-linux-arm64"],
	["linux-x64", "vitest-agent-sidecar-linux-x64"],
	["win32-x64", "vitest-agent-sidecar-win32-x64"],
]);

/**
 * Resolve the absolute path of the platform-specific sidecar binary.
 *
 * The four platform packages that ship SEA binaries are:
 *   - `vitest-agent-sidecar-darwin-arm64`  → `bin/vitest-agent-sidecar`
 *   - `vitest-agent-sidecar-linux-arm64`   → `bin/vitest-agent-sidecar`
 *   - `vitest-agent-sidecar-linux-x64`     → `bin/vitest-agent-sidecar`
 *   - `vitest-agent-sidecar-win32-x64`     → `bin/vitest-agent-sidecar.exe`
 *
 * The binary path is resolved via `require.resolve` of the platform package's
 * bin entry (not discovered on PATH), so transitive optional dependencies that
 * are never hoisted to `node_modules/.bin/` are still found correctly.
 *
 * Returns `null` when:
 *   - The platform/arch combination has no matching package (e.g. darwin-x64).
 *   - The matching optional dependency was not installed (MODULE_NOT_FOUND).
 *
 * @param options - Optional overrides for platform, arch, and resolver (for testing).
 * @returns The absolute path to the binary, or `null` when not resolvable.
 */
export function resolveSidecarBinaryPath(options: ResolveSidecarBinaryPathOptions = {}): string | null {
	const platform = options.platform ?? (process.platform as NodeJS.Platform);
	const arch = options.arch ?? process.arch;

	const key = `${platform}-${arch}`;
	const packageName = SUPPORTED_PLATFORMS.get(key);

	// Unsupported platform/arch combination — no package exists
	if (packageName === undefined) {
		return null;
	}

	// The bin file path inside the package differs by OS
	const binFile = platform === "win32" ? "bin/vitest-agent-sidecar.exe" : "bin/vitest-agent-sidecar";
	const resolvePath = `${packageName}/${binFile}`;

	// Use the injected resolver (for tests) or the real `require.resolve`
	// method — NOT the bare `require` function, which would load and
	// execute the resolved binary instead of returning its path.
	const resolve = options.resolver ?? createRequire(import.meta.url).resolve;

	try {
		return resolve(resolvePath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "MODULE_NOT_FOUND") {
			return null;
		}
		throw err;
	}
}

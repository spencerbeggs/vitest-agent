/**
 * \@vitest-agent/sidecar
 *
 * Resolves the absolute path of the platform-specific sidecar binary through
 * `@effected/commands`' `PrebuiltBinary`, anchored at this package so module
 * resolution finds the optional platform packages it declares.
 *
 * @packageDocumentation
 */

import type { PrebuiltHost, PrebuiltTarget } from "@effected/commands";
import { PrebuiltBinary } from "@effected/commands";
import { nodePrebuiltHost } from "@effected/commands/node-sync";
import { Result } from "effect";

/**
 * Platform and architecture resolver options for dependency injection in tests.
 *
 * @public
 */
export interface ResolveSidecarBinaryPathOptions {
	/** Override the platform (defaults to `process.platform`). */
	readonly platform?: NodeJS.Platform;
	/** Override the architecture (defaults to `process.arch`). */
	readonly arch?: string;
	/** Override the module resolver (defaults to `require.resolve` anchored at this package). */
	readonly resolver?: (path: string) => string;
}

/**
 * Target key to the platform package carrying its SEA binary. Each package's
 * `.` export is the binary itself (the bundler points it at the suffixed SEA,
 * `.exe` on win32), so the spec names no subpath. darwin-x64 is intentionally
 * absent: there is no such package.
 */
const SIDECAR_PACKAGES = {
	packages: {
		"darwin-arm64": "@vitest-agent/sidecar-darwin-arm64",
		"linux-arm64": "@vitest-agent/sidecar-linux-arm64",
		"linux-x64": "@vitest-agent/sidecar-linux-x64",
		"win32-x64": "@vitest-agent/sidecar-win32-x64",
	},
} as const;

/**
 * The host the resolution runs against. The anchor MUST be a module of this
 * package: `require.resolve` finds an optional dependency only from inside the
 * package that declares it. The node host is built only when an override
 * leaves something for it to supply; an overridden platform drops the host's
 * libc, which describes the real Linux host, not the requested target.
 */
function makeHost(options: ResolveSidecarBinaryPathOptions): PrebuiltHost {
	const { platform, arch, resolver } = options;
	if (platform !== undefined && arch !== undefined && resolver !== undefined) {
		return { target: { platform, arch }, resolve: resolver };
	}
	const node = nodePrebuiltHost(import.meta.url);
	const target: PrebuiltTarget =
		platform === undefined
			? { ...node.target, ...(arch !== undefined ? { arch } : {}) }
			: { platform, arch: arch ?? node.target.arch };
	return { target, resolve: resolver ?? node.resolve };
}

/**
 * Resolve the absolute path of the platform-specific sidecar binary.
 *
 * The four platform packages that ship SEA binaries are:
 *   - `@vitest-agent/sidecar-darwin-arm64`
 *   - `@vitest-agent/sidecar-linux-arm64`
 *   - `@vitest-agent/sidecar-linux-x64`
 *   - `@vitest-agent/sidecar-win32-x64` (an `.exe`)
 *
 * The binary path is resolved through the platform package's `.` export (not
 * discovered on PATH), so transitive optional dependencies that are never
 * hoisted to `node_modules/.bin/` are still found.
 *
 * Returns `null` when the platform/arch combination has no matching package
 * (e.g. darwin-x64), when the matching optional dependency was not installed,
 * or when it is installed without its binary. Any other resolution failure is
 * a packaging fault and is rethrown as the resolver's own error.
 *
 * @param options - Optional overrides for platform, arch, and resolver (for testing).
 * @returns The absolute path to the binary, or `null` when not resolvable.
 * @public
 */
export function resolveSidecarBinaryPath(options: ResolveSidecarBinaryPathOptions = {}): string | null {
	const resolved = PrebuiltBinary.resolveSync(SIDECAR_PACKAGES, makeHost(options));
	if (Result.isSuccess(resolved)) return resolved.success.path;
	const error = resolved.failure;
	if (error.reason === "unresolvable") throw error.cause ?? error;
	return null;
}

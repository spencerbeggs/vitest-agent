#!/usr/bin/env node

/**
 * vitest-agent-sidecar launcher shim.
 *
 * Resolves the platform-specific binary shipped by the matching
 * `vitest-agent-sidecar-<platform>` optionalDependency and execs into
 * it, forwarding argv and stdio. When no matching sub-package is
 * installed (the user's platform is not one of the five we ship, or
 * the optional dependency was skipped), exits non-zero with a clear
 * stderr message so the bash hook's JS-fallback path triggers.
 *
 * Pattern lifted from esbuild's npm/esbuild/install.js.
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

// `${platform}-${arch}` keys the five sub-packages: darwin/linux/win32
// crossed with arm64/x64.
const platformKey = `${process.platform}-${process.arch}`;
const subPackage = `vitest-agent-sidecar-${platformKey}`;
const binaryName = process.platform === "win32" ? "vitest-agent-sidecar.exe" : "vitest-agent-sidecar";

function resolveBinary() {
	try {
		// The sub-package exposes its binary at <pkg>/bin/<binaryName>.
		const pkgJson = require.resolve(`${subPackage}/package.json`);
		return path.join(path.dirname(pkgJson), "bin", binaryName);
	} catch {
		return null;
	}
}

const binary = resolveBinary();

if (binary === null) {
	process.stderr.write(
		`vitest-agent-sidecar: no prebuilt binary for ${platformKey}; ` +
			`expected the optional dependency "${subPackage}". ` +
			"Falling back to the vitest-agent-cli JS path.\n",
	);
	process.exit(127);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
	process.stderr.write(`vitest-agent-sidecar: failed to exec ${binary}: ${result.error.message}\n`);
	process.exit(126);
}

process.exit(result.status === null ? 1 : result.status);

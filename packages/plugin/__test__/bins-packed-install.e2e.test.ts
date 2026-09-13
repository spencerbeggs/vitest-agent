/**
 * Packed-install e2e: proves the carrier's bins reach a consumer that is
 * NOT part of this monorepo, once per package manager on PATH.
 *
 * Every `@vitest-agent/*` prod build under `packages/<p>/dist/prod/npm/pkg`
 * is packed to a tarball, a scratch consumer project outside the workspace
 * declares `@vitest-agent/plugin` from its tarball with every family
 * package overridden to its own tarball, and the package manager under test
 * installs it. The assertions are the ones from issue #412's verification
 * section: `node_modules/.bin/vitest-agent` exists and is executable,
 * `vitest-agent --version` exits 0 with a semver on stdout, and
 * `vitest-agent-mcp` answers a JSON-RPC `initialize` with empty stderr.
 *
 * This is deliberately plain Vitest + `node:child_process`: the subject is
 * the package managers and the published manifests, not Effect.
 *
 * Gates:
 * - The whole suite skips unless the plugin's prod build exists (`pnpm build`).
 * - Each package-manager block skips unless that manager is on PATH.
 * - Set `KEEP_PACKED_INSTALL=1` to keep the scratch directory for inspection.
 */

import { spawnSync } from "node:child_process";
import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const prodPkgDir = (pkg: string): string => join(REPO_ROOT, "packages", pkg, "dist", "prod", "npm", "pkg");
const PLUGIN_PROD_MANIFEST = join(prodPkgDir("plugin"), "package.json");

const SIDECAR_PLATFORM_PACKAGES = [
	"sidecar-darwin-arm64",
	"sidecar-linux-arm64",
	"sidecar-linux-x64",
	"sidecar-win32-x64",
] as const;
const HOST_SIDECAR = `sidecar-${process.platform}-${process.arch}`;
const HOST_HAS_SIDECAR = (SIDECAR_PLATFORM_PACKAGES as readonly string[]).includes(HOST_SIDECAR);

/** Workspace packages packed into the scratch directory, in dependency order. */
const PACK_LIST: readonly string[] = [
	"sdk",
	"engine",
	"ui",
	"reporter",
	"sidecar",
	...(HOST_HAS_SIDECAR ? [HOST_SIDECAR] : []),
	"cli",
	"mcp",
	"plugin",
];

const PACK_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 240_000;
const INSTALL_TEST_TIMEOUT_MS = INSTALL_TIMEOUT_MS + 60_000;
const BIN_TIMEOUT_MS = 60_000;

const PROD_BUILD_PRESENT = existsSync(PLUGIN_PROD_MANIFEST);
const IS_WINDOWS = process.platform === "win32";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SpawnResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly status: number | null;
	readonly error: Error | undefined;
}

interface SpawnOptions {
	readonly cwd: string;
	readonly timeout: number;
	readonly input?: string;
	readonly env?: NodeJS.ProcessEnv;
}

const run = (command: string, args: readonly string[], options: SpawnOptions): SpawnResult => {
	const result = spawnSync(command, [...args], {
		cwd: options.cwd,
		encoding: "utf-8",
		timeout: options.timeout,
		env: options.env ?? process.env,
		...(options.input !== undefined ? { input: options.input } : {}),
	});
	return {
		stdout: typeof result.stdout === "string" ? result.stdout : "",
		stderr: typeof result.stderr === "string" ? result.stderr : "",
		status: result.status,
		error: result.error,
	};
};

const describeFailure = (label: string, result: SpawnResult): string =>
	[
		`${label} failed (status ${result.status}${result.error ? `, error ${result.error.message}` : ""})`,
		"--- stdout ---",
		result.stdout,
		"--- stderr ---",
		result.stderr,
	].join("\n");

/**
 * Is the package manager invocable from a directory outside this repo?
 *
 * Probed from the OS temp dir on purpose: the repo's `packageManager` pin
 * makes corepack shims refuse to run any other manager from inside it.
 */
const hasPackageManager = (pm: string): boolean => {
	const result = run(pm, ["--version"], { cwd: tmpdir(), timeout: BIN_TIMEOUT_MS });
	return result.error === undefined && result.status === 0;
};

/**
 * Environment for the spawned package managers and bins.
 *
 * Strips the `npm_*` variables the parent pnpm/vitest process injects (they
 * leak config such as `npm_config_user_agent` into the child manager), drops
 * `CI` (yarn berry turns on immutable installs under CI, which cannot work
 * without a lockfile), and points `XDG_DATA_HOME` at the scratch dir so
 * `vitest-agent` never touches the developer's real data directory.
 */
const makeEnv = (scratch: string): NodeJS.ProcessEnv => {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("npm_") || key === "CI" || key === "INIT_CWD") continue;
		env[key] = value;
	}
	env.XDG_DATA_HOME = join(scratch, "xdg-data");
	return env;
};

interface PackedPackage {
	readonly name: string;
	readonly version: string;
	readonly tarball: string;
	readonly dependencyNames: readonly string[];
}

const readManifest = (dir: string): { name: string; version: string; [key: string]: unknown } =>
	JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));

const familyDependencyNames = (manifest: Record<string, unknown>): string[] => {
	const names = new Set<string>();
	for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
		const block = manifest[field];
		if (block && typeof block === "object") {
			for (const name of Object.keys(block)) {
				if (name.startsWith("@vitest-agent/")) names.add(name);
			}
		}
	}
	return [...names];
};

/**
 * `npm pack` is used for every package regardless of the manager under test:
 * it works from any prod dir, needs no workspace, and `--json` prints the
 * tarball filename so nothing has to be guessed from name + version.
 */
const packOne = (pkg: string, destination: string): PackedPackage => {
	const dir = prodPkgDir(pkg);
	if (!existsSync(join(dir, "package.json"))) {
		throw new Error(`missing prod build for packages/${pkg} — run \`pnpm build\` (expected ${dir}/package.json)`);
	}
	const result = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
		cwd: dir,
		timeout: PACK_TIMEOUT_MS,
	});
	if (result.status !== 0) {
		throw new Error(describeFailure(`npm pack (${pkg})`, result));
	}
	const parsed = JSON.parse(result.stdout) as ReadonlyArray<{ filename: string; name: string; version: string }>;
	const entry = parsed[0];
	if (!entry) {
		throw new Error(`npm pack (${pkg}) printed no tarball entry:\n${result.stdout}`);
	}
	const manifest = readManifest(dir);
	return {
		name: manifest.name,
		version: manifest.version,
		tarball: join(destination, entry.filename),
		dependencyNames: familyDependencyNames(manifest),
	};
};

// ---------------------------------------------------------------------------
// Package manager matrix
// ---------------------------------------------------------------------------

interface PackageManager {
	readonly name: "npm" | "pnpm" | "yarn" | "bun";
	/** Extra files the consumer needs before `install` (none for npm, bun). */
	readonly prepare?: (consumerDir: string, overrides: Readonly<Record<string, string>>) => void;
	readonly installArgs: readonly string[];
}

const PACKAGE_MANAGERS: readonly PackageManager[] = [
	{
		name: "npm",
		installArgs: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
	},
	{
		name: "pnpm",
		// pnpm >= 10 reads `overrides` from pnpm-workspace.yaml and pnpm 11 no
		// longer reads `package.json#pnpm` at all. A settings-only file with no
		// `packages:` key keeps the consumer a standalone project (not a
		// multi-package workspace) while carrying the tarball overrides.
		prepare: (dir, overrides) => {
			writeFileSync(join(dir, ".npmrc"), "auto-install-peers=true\n");
			const lines = ["overrides:"];
			for (const [name, spec] of Object.entries(overrides)) {
				lines.push(`  "${name}": "${spec}"`);
			}
			lines.push("");
			writeFileSync(join(dir, "pnpm-workspace.yaml"), lines.join("\n"));
		},
		installArgs: ["install", "--ignore-scripts"],
	},
	{
		name: "yarn",
		// Berry defaults to Plug'n'Play, which never materializes
		// node_modules/.bin — the surface under test. The node-modules linker
		// is the ordinary consumer choice for a Node bin. Immutable installs
		// are off because a fresh scratch project has no lockfile yet. Classic
		// yarn ignores this file entirely.
		prepare: (dir) =>
			writeFileSync(
				join(dir, ".yarnrc.yml"),
				[
					"nodeLinker: node-modules",
					"enableImmutableInstalls: false",
					"enableScripts: false",
					"enableTelemetry: false",
					"",
				].join("\n"),
			),
		// Berry has no --ignore-scripts; `enableScripts: false` in .yarnrc.yml is the equivalent.
		installArgs: ["install"],
	},
	{
		name: "bun",
		installArgs: ["install", "--ignore-scripts"],
	},
];

/**
 * The consumer manifest. Each manager reads its own override field:
 * npm and bun read `overrides`, pnpm reads `pnpm.overrides`, yarn reads
 * `resolutions`. All three carry the same map so one manifest serves every
 * manager. The carrier itself is a devDependency (not an override) — npm
 * rejects an override that conflicts with a direct dependency spec.
 */
const writeConsumerManifest = (
	consumerDir: string,
	packed: readonly PackedPackage[],
	vitestVersion: string,
): Readonly<Record<string, string>> => {
	const plugin = packed.find((p) => p.name === "@vitest-agent/plugin");
	if (!plugin) throw new Error("plugin tarball missing from pack list");
	const overrides: Record<string, string> = {};
	for (const pkg of packed) {
		if (pkg.name === plugin.name) continue;
		overrides[pkg.name] = `file:${pkg.tarball}`;
	}
	const manifest = {
		name: "consumer",
		private: true,
		devDependencies: {
			"@vitest-agent/plugin": `file:${plugin.tarball}`,
			vitest: vitestVersion,
		},
		overrides,
		pnpm: { overrides },
		resolutions: overrides,
	};
	mkdirSync(consumerDir, { recursive: true });
	writeFileSync(join(consumerDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	return overrides;
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const SUITE_NAME = PROD_BUILD_PRESENT
	? "packed-install"
	: "packed-install (skipped: needs `pnpm build` — no packages/plugin/dist/prod/npm/pkg)";

describe.skipIf(!PROD_BUILD_PRESENT || IS_WINDOWS)(SUITE_NAME, () => {
	let scratch = "";
	let packed: readonly PackedPackage[] = [];
	let vitestVersion = "";

	beforeAll(() => {
		scratch = mkdtempSync(join(tmpdir(), "vitest-agent-packed-"));
		const tarballs = join(scratch, "tarballs");
		mkdirSync(tarballs);
		packed = PACK_LIST.map((pkg) => packOne(pkg, tarballs));
		// Intentional, read-only exception to "never touch the repo's node_modules":
		// the vitest peer version comes from the pnpm catalog, so no manifest in the
		// repo states it literally — the installed package is the only place to read it.
		vitestVersion = readManifest(join(REPO_ROOT, "node_modules", "vitest")).version;
	}, PACK_TIMEOUT_MS * PACK_LIST.length);

	afterAll(() => {
		if (process.env.KEEP_PACKED_INSTALL === "1") {
			console.info(`KEEP_PACKED_INSTALL=1 — scratch kept at ${scratch}`);
			return;
		}
		if (scratch) rmSync(scratch, { recursive: true, force: true });
	});

	it("packs every family package the carrier depends on", () => {
		const packedNames = new Set(packed.map((p) => p.name));
		const referenced = new Set(packed.flatMap((p) => p.dependencyNames));
		// The three non-host sidecar platform packages are optionalDependencies
		// of @vitest-agent/sidecar and are intentionally left unmapped: the
		// package manager must tolerate an optional dependency it cannot use on
		// this host. Everything else the tarballs reference must be packed.
		const unmapped = [...referenced].filter(
			(name) => !packedNames.has(name) && !name.startsWith("@vitest-agent/sidecar-"),
		);
		expect(unmapped).toEqual([]);
		expect(packedNames.has("@vitest-agent/plugin")).toBe(true);
		expect(packedNames.has("@vitest-agent/cli")).toBe(true);
		expect(packedNames.has("@vitest-agent/mcp")).toBe(true);
	});

	for (const pm of PACKAGE_MANAGERS) {
		const available = hasPackageManager(pm.name);
		const blockName = available ? pm.name : `${pm.name} (skipped: not on PATH)`;

		describe.skipIf(!available)(blockName, () => {
			let consumerDir = "";
			let binDir = "";
			let env: NodeJS.ProcessEnv = {};

			beforeAll(() => {
				consumerDir = join(scratch, `consumer-${pm.name}`);
				binDir = join(consumerDir, "node_modules", ".bin");
				env = makeEnv(scratch);
				const overrides = writeConsumerManifest(consumerDir, packed, vitestVersion);
				pm.prepare?.(consumerDir, overrides);
				const result = run(pm.name, pm.installArgs, { cwd: consumerDir, timeout: INSTALL_TIMEOUT_MS, env });
				if (result.status !== 0) {
					throw new Error(describeFailure(`${pm.name} ${pm.installArgs.join(" ")}`, result));
				}
			}, INSTALL_TEST_TIMEOUT_MS);

			it("links node_modules/.bin/vitest-agent as an executable", () => {
				const bin = join(binDir, "vitest-agent");
				expect(existsSync(bin), `expected ${bin} to exist`).toBe(true);
				expect(() => accessSync(bin, constants.X_OK)).not.toThrow();
			});

			it(
				"vitest-agent --version exits 0 and prints a semver",
				() => {
					const bin = join(binDir, "vitest-agent");
					const result = run(bin, ["--version"], { cwd: consumerDir, timeout: BIN_TIMEOUT_MS, env });
					expect(result.status, describeFailure("vitest-agent --version", result)).toBe(0);
					expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
				},
				BIN_TIMEOUT_MS,
			);

			it("links node_modules/.bin/vitest-agent-mcp as an executable", () => {
				const bin = join(binDir, "vitest-agent-mcp");
				expect(existsSync(bin), `expected ${bin} to exist`).toBe(true);
				expect(() => accessSync(bin, constants.X_OK)).not.toThrow();
			});

			it(
				"vitest-agent-mcp answers a JSON-RPC initialize on stdout with empty stderr",
				() => {
					const bin = join(binDir, "vitest-agent-mcp");
					const initialize = JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "initialize",
						params: {
							protocolVersion: "2025-06-18",
							capabilities: {},
							clientInfo: { name: "packed-install-e2e", version: "0.0.0" },
						},
					});
					const result = run(bin, [], {
						cwd: consumerDir,
						timeout: BIN_TIMEOUT_MS,
						env,
						input: `${initialize}\n`,
					});
					expect(result.stdout).toContain('"serverInfo"');
					expect(result.stderr).toBe("");
					expect(result.status).toBe(0);
				},
				BIN_TIMEOUT_MS,
			);
		});
	}
});

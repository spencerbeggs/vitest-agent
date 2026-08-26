/**
 * Issue #303: `run_tests` used to `await import("vitest/node")` with a bare
 * specifier, which resolves relative to `@vitest-agent/mcp`'s OWN install
 * location — not the project under test. pnpm routinely materializes more
 * than one physical instance of the same vitest version when peer-resolution
 * hashes differ, so the MCP server can end up driving a *different* vitest
 * copy than the one the project's test files import. Because
 * `SnapshotClient.setup()` mutates a module-level singleton, running the
 * wrong copy leaves the test-file's copy with no snapshot state — every
 * `toMatchSnapshot()` assertion then fails with "The snapshot state for
 * '<file>' is not found", while every non-snapshot assertion still passes.
 *
 * `resolveVitestNodeEntry(root)` fixes this by anchoring resolution at the
 * run's project root via `createRequire`, so it resolves whatever `vitest`
 * copy IS installed under that root — not whatever copy happens to be
 * hoisted next to `@vitest-agent/mcp`.
 *
 * Seam: a real tmpdir fixture (this helper touches the filesystem via
 * `createRequire`, so memfs will not work) with its own
 * `node_modules/vitest/package.json` + `dist/node.js` stub. The
 * discriminating assertion is that the returned URL points at THIS fixture
 * copy, not the repo's own hoisted `vitest` — the mutation that matters is
 * exactly the bug: a helper that ignores `root` and always resolves the
 * bare specifier would still pass a weaker "returns a file:// URL" check
 * but fail "resolves to the fixture's node_modules/vitest".
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveVitestNodeEntry } from "../src/tools/run-tests.js";

describe("resolveVitestNodeEntry", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "va-resolve-vitest-node-entry-"));
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("returns a file URL pointing at the vitest copy installed under the given root, not the mcp package's own hoisted copy", () => {
		const vitestDir = join(tmpRoot, "node_modules", "vitest");
		mkdirSync(join(vitestDir, "dist"), { recursive: true });
		writeFileSync(
			join(vitestDir, "package.json"),
			JSON.stringify({
				name: "vitest",
				type: "module",
				exports: { "./node": { default: "./dist/node.js" } },
			}),
		);
		writeFileSync(join(vitestDir, "dist", "node.js"), "export const createVitest = () => {};\n");

		const entry = resolveVitestNodeEntry(tmpRoot);
		// realpathSync: on macOS `tmpdir()` returns a path under `/tmp`, a
		// symlink to `/private/tmp`; Node's module resolution (and therefore
		// `createRequire(...).resolve`) returns the resolved (symlink-free)
		// path, so the expectation must go through the same resolution to
		// compare like with like.
		const expectedPath = realpathSync(join(tmpRoot, "node_modules", "vitest", "dist", "node.js"));

		expect(entry.startsWith("file://")).toBe(true);
		expect(decodeURIComponent(new URL(entry).pathname)).toBe(expectedPath);
		// The discriminating assertion: this must NOT be the repo's own
		// hoisted vitest copy (mcp's node_modules), which is what the old
		// bare-specifier `await import("vitest/node")` always resolved to
		// regardless of the run's project root.
		expect(entry).not.toContain("packages/mcp/node_modules/vitest");
	});

	it('falls back to the bare "vitest/node" specifier when root-anchored resolution throws', () => {
		// An EMPTY tmpdir is not a reliable "nothing resolvable from here" fixture.
		// `createRequire` resolution walks UP through every ancestor's node_modules,
		// so on a runner whose temp dir sits inside the repo checkout it finds the
		// repo's own vitest and resolves instead of throwing — which is exactly how
		// this test failed in CI while passing locally, where `tmpdir()` is `/private/tmp`
		// and has no vitest above it.
		//
		// Plant a vitest package whose `exports` map has no "./node" subpath instead.
		// Node stops at the FIRST matching package name and throws
		// ERR_PACKAGE_PATH_NOT_EXPORTED rather than continuing the walk, so the throw
		// is deterministic no matter what sits above the fixture.
		const vitestDir = join(tmpRoot, "node_modules", "vitest");
		mkdirSync(vitestDir, { recursive: true });
		writeFileSync(
			join(vitestDir, "package.json"),
			JSON.stringify({ name: "vitest", type: "module", exports: { ".": "./index.js" } }),
		);

		expect(resolveVitestNodeEntry(tmpRoot)).toBe("vitest/node");
	});
});

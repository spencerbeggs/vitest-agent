/**
 * Issue #387: `resolve-vitest-node-entry.test.ts` proves `resolveVitestNodeEntry`
 * resolves a PATH under the given root. It never proves the property the
 * resolution exists for — that the `vitest/node` module the MCP server drives
 * is the SAME module instance the project's test files import. The hazard is
 * module-level state: `SnapshotClient.setup()` mutates a singleton, so a second
 * physical copy of vitest answers every snapshot assertion with "Snapshot state
 * for '<file>' is not found" while every other assertion passes.
 *
 * This suite pins module identity against the live repo layout: the entry the
 * server resolves for this repository's Vitest root must realpath to the entry
 * a test file in each workspace package resolves, and importing both must yield
 * the same `createVitest` function (`Object.is`). A pnpm layout change that
 * materializes a second vitest copy for one package (a peer-hash split, say)
 * fails here loudly instead of as a snapshot failure in a consumer's run.
 *
 * Node's ESM loader keys its module map on the resolved, symlink-free URL, so
 * two paths that realpath to one file share one instance — which is why the
 * realpath assertion and the identity assertion are kept separate: the first
 * says the two resolutions agree, the second says the loader agrees with them.
 * The control imports one source twice through two distinct physical copies
 * and asserts `Object.is` is FALSE, proving the identity check can discriminate.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveVitestNodeEntry } from "../src/tools/run-tests.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** A test file location in each workspace package whose tests the server runs. */
const PROJECT_TEST_FILES = [
	join(repoRoot, "packages", "sdk", "__test__", "__probe__.test.ts"),
	join(repoRoot, "packages", "engine", "__test__", "__probe__.test.ts"),
	join(repoRoot, "packages", "plugin", "__test__", "__probe__.test.ts"),
	join(repoRoot, "packages", "mcp", "__test__", "__probe__.test.ts"),
	join(repoRoot, "playground", "src", "__probe__.test.ts"),
];

interface VitestNode {
	readonly createVitest: unknown;
}

describe("vitest/node module identity (issue #387)", () => {
	it("resolves the server's entry for the repo root to a file URL", () => {
		const entry = resolveVitestNodeEntry(repoRoot);
		expect(entry.startsWith("file:")).toBe(true);
	});

	it("resolves to the same physical file a project test file resolves, in every workspace package", () => {
		const serverEntry = realpathSync(fileURLToPath(resolveVitestNodeEntry(repoRoot)));
		for (const testFile of PROJECT_TEST_FILES) {
			const projectEntry = realpathSync(createRequire(testFile).resolve("vitest/node"));
			expect(projectEntry, `vitest/node resolved from ${testFile}`).toBe(serverEntry);
		}
	});

	it("loads the same module instance through the server's entry and through a project test file's resolution", async () => {
		const serverEntry = resolveVitestNodeEntry(repoRoot);
		const viaServer = (await import(serverEntry)) as VitestNode;
		expect(typeof viaServer.createVitest).toBe("function");
		for (const testFile of PROJECT_TEST_FILES) {
			const projectEntry = pathToFileURL(createRequire(testFile).resolve("vitest/node")).href;
			const viaProject = (await import(projectEntry)) as VitestNode;
			expect(Object.is(viaServer.createVitest, viaProject.createVitest), `module identity from ${testFile}`).toBe(true);
		}
	});

	it("control: two physical copies of one module are two instances, so the identity check can fail", async () => {
		const dir = mkdtempSync(join(tmpdir(), "va-module-identity-"));
		try {
			const source = "export const createVitest = () => {};\n";
			const a = join(dir, "a.mjs");
			const b = join(dir, "b.mjs");
			writeFileSync(a, source);
			writeFileSync(b, source);
			const viaA = (await import(pathToFileURL(a).href)) as VitestNode;
			const viaB = (await import(pathToFileURL(b).href)) as VitestNode;
			expect(Object.is(viaA.createVitest, viaB.createVitest)).toBe(false);
			// And the same file reached twice IS one instance — the positive half of the control.
			const viaAAgain = (await import(pathToFileURL(a).href)) as VitestNode;
			expect(Object.is(viaA.createVitest, viaAAgain.createVitest)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

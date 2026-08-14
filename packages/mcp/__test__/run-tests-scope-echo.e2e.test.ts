/**
 * `run_tests` echoes the resolved scope (files, project, tags) it
 * actually used on a successful run (issue #200). Before this, `RunTestsOk`
 * echoed only `project` — an agent that believed a call was scoped to one
 * file (e.g. a dropped/misspelled param) had no way to tell from the
 * success payload that the run actually covered everything.
 *
 * `.e2e.test.ts`: runs a real nested Vitest instance in-process against a
 * tiny isolated fixture project — see `run-tests-console-leaks.e2e.test.ts`
 * for the same pattern.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { test } from "./integration/utils/fixtures.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixtureDir = join(fixturesRoot, "console-leak-project");
// Named project + two declared tags, so a project- or tag-scoped run can
// actually succeed (the console-leak fixture declares neither, so both
// filters could only ever produce the `no-match` variant).
const scopedFixtureDir = join(fixturesRoot, "scope-echo-project");
let xdgDir: string;

beforeAll(() => {
	xdgDir = mkdtempSync(join(tmpdir(), "va-run-tests-scope-xdg-"));
	process.env.XDG_DATA_HOME = xdgDir;
});

afterAll(() => {
	delete process.env.XDG_DATA_HOME;
	rmSync(xdgDir, { recursive: true, force: true });
});

const makeCaller = (runtime: unknown, cwd: string = fixtureDir) =>
	createCallerFactory(appRouter)({
		runtime: runtime as McpContext["runtime"],
		cwd,
		currentSessionId: createCurrentSessionIdRef(null),
		sessionContext: createSessionContextRef(),
	});

describe("run_tests echoes the resolved scope on success (e2e)", () => {
	test("an unfiltered run echoes an empty scope", { timeout: 120_000 }, async ({ runtime }) => {
		const caller = makeCaller(runtime);
		const result = await caller.run_tests({});

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.scope).toEqual({ project: null, files: [], tags: null });
	});

	test("a files-scoped run echoes the resolved files back", { timeout: 120_000 }, async ({ runtime }) => {
		const caller = makeCaller(runtime);
		const result = await caller.run_tests({ files: ["leaky.test.ts"] });

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.scope).toEqual({ project: null, files: ["leaky.test.ts"], tags: null });
	});

	test("a project-scoped run echoes the resolved project back", { timeout: 120_000 }, async ({ runtime }) => {
		const caller = makeCaller(runtime, scopedFixtureDir);
		const result = await caller.run_tests({ project: "scope-echo" });

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.scope).toEqual({ project: "scope-echo", files: [], tags: null });
	});

	test("a tag-scoped run echoes the structured tag filter back verbatim", { timeout: 120_000 }, async ({ runtime }) => {
		const caller = makeCaller(runtime, scopedFixtureDir);
		const result = await caller.run_tests({ tags: { any: ["unit"] } });

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.scope.project).toBeNull();
		expect(result.scope.files).toEqual([]);
		// Echoed verbatim (not flattened to the composed Vitest expression),
		// so the agent can diff what it asked for against what ran.
		expect(result.scope.tags).toEqual({ any: ["unit"] });
		// ...and the echo is not cosmetic: exactly one of the fixture's two
		// tests actually executed, so the int-tagged one was filtered out
		// (Vitest still collects it, hence total stays 2).
		expect(result.report.summary.passed).toBe(1);
	});

	test("project and tag filters AND together in the echoed scope", { timeout: 120_000 }, async ({ runtime }) => {
		const caller = makeCaller(runtime, scopedFixtureDir);
		const result = await caller.run_tests({ project: "scope-echo", tags: { none: ["int"] } });

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.scope).toEqual({ project: "scope-echo", files: [], tags: { none: ["int"] } });
	});
});

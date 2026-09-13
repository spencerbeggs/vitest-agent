/**
 * A SUCCESSFUL `run_tests` through the real wire: the in-process stdio
 * harness runs the fixture projects with a nested Vitest and the result
 * travels through `Toolkit`'s `Schema.encodeUnknownEffect(successSchema)`
 * before it reaches `structuredContent`. The `makeCaller` e2e suites bypass
 * that encoder, so this is the guard that `RunTestsOk` (report, scope,
 * classifications, scopedNote, consoleLeaks) stays encodable — the failure
 * class that bit the tdd_goal / tdd_behavior envelopes.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpSession } from "../src/session.js";
import type { McpHarness } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

interface CallToolResult {
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const leakFixtureDir = join(fixturesRoot, "console-leak-project");
const scopedFixtureDir = join(fixturesRoot, "scope-echo-project");
let xdgDir: string;

beforeAll(() => {
	// Isolate AgentPlugin DB writes into a throwaway XDG dir so the fixture
	// run does not collide with the monorepo's own data.db.
	xdgDir = mkdtempSync(join(tmpdir(), "va-run-tests-wire-xdg-"));
	process.env.XDG_DATA_HOME = xdgDir;
});

afterAll(() => {
	delete process.env.XDG_DATA_HOME;
	rmSync(xdgDir, { recursive: true, force: true });
});

/** initialize, call run_tests once against `cwd`, return the result and the harness stderr. */
const runOnce = (cwd: string, args: unknown) =>
	Effect.runPromise(
		Effect.scoped(
			Effect.flatMap(makeHarness({ session: McpSession.layerTest({ cwd }) }), (h: McpHarness) =>
				h.initialize().pipe(
					Effect.andThen(h.callTool("run_tests", args)),
					Effect.flatMap((result) =>
						Effect.map(h.stderrSoFar, (stderr) => ({ result: result as CallToolResult, stderr })),
					),
				),
			),
		),
	);

describe("run_tests success through the wire encoder (e2e)", () => {
	it("a files-scoped run returns kind ok with report, scope, classifications, scopedNote and consoleLeaks intact", {
		timeout: 120_000,
	}, async () => {
		const { result, stderr } = await runOnce(leakFixtureDir, { files: ["leaky.test.ts"] });
		expect(result.isError).toBe(false);
		expect(stderr).toEqual([]);
		const structured = result.structuredContent as {
			kind: string;
			projectRoot: string;
			scope: unknown;
			report: {
				summary: { passed: number };
				consoleLeaks?: { total: number; byFile: Array<{ file: string; sample?: string }> };
			};
			classifications: Record<string, string>;
			scopedNote: string | null;
		};
		expect(structured.kind).toBe("ok");
		expect(structured.projectRoot).toBe(leakFixtureDir);
		expect(structured.scope).toEqual({ project: null, files: ["leaky.test.ts"], tags: null });
		expect(structured.report.summary.passed).toBeGreaterThan(0);
		expect(typeof structured.classifications).toBe("object");
		// A scoped run carries the coverage-denominator note (issue #160).
		expect(typeof structured.scopedNote).toBe("string");
		// The leak fold survives encoding (issue #263).
		expect(structured.report.consoleLeaks?.total).toBe(2);
		expect(structured.report.consoleLeaks?.byFile[0]?.file.endsWith("leaky.test.ts")).toBe(true);
		expect(structured.report.consoleLeaks?.byFile[0]?.sample).toContain("DEBUG cache miss for key abc");
		const text = result.content[0]?.text ?? "";
		expect(text.length).toBeGreaterThan(0);
		expect(text).toContain("Vitest --");
		expect(text).toContain(`Project root: \`${leakFixtureDir}\``);
		expect(text).toContain("stray console write");
	});

	it("a project + tag scoped run echoes the structured filter verbatim through the encoder", {
		timeout: 120_000,
	}, async () => {
		const { result, stderr } = await runOnce(scopedFixtureDir, { project: "scope-echo", tags: { none: ["int"] } });
		expect(result.isError).toBe(false);
		expect(stderr).toEqual([]);
		expect(result.structuredContent).toMatchObject({
			kind: "ok",
			project: "scope-echo",
			scope: { project: "scope-echo", files: [], tags: { none: ["int"] } },
		});
		const report = result.structuredContent?.report as { summary: { passed: number } } | undefined;
		expect(report?.summary.passed).toBe(1);
	});
});

/**
 * Characterization of `run_tests`'s pure result-shaping branches (issue
 * #336): scope derivation (files / project / tags sanitization and the
 * composed tag expression), the filter-driven `no-match` discriminator, and
 * the `ok` / `no-match` payload shapes (scope echo, projectRoot echo,
 * scopedNote, discoveryLastScannedAt, classifications).
 *
 * Seam: `vitestLoader` is substituted with a fake `createVitest` whose
 * `start()` resolves plain values, so no nested Vitest runs. The fixture
 * `cwd` carries its own `.git` and `vitest.config.ts`, so the config-anchored
 * default root is the fixture itself and never walks into the host tree.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectDiscoveryTest } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import type { AgentReport } from "@vitest-agent/sdk";
import { formatScopedCoverageNote } from "@vitest-agent/sdk";
import { Layer, ManagedRuntime, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpSession } from "../src/session.js";
import type { RunScope } from "../src/tools/run-tests.js";
import { deriveRunScope, isNoMatch, toNoMatch, toOkPayload, vitestLoader } from "../src/tools/run-tests.js";
import type { ToolParams } from "./utils/caller.js";
import { makeCaller as makeToolCaller } from "./utils/caller.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, ProjectDiscoveryTest.layer([]));
const DISCOVERY_LAST_SCAN_SYMBOL = Symbol.for("vitest-agent:discovery:last-scan-at");

interface FakeRun {
	readonly testModules?: ReadonlyArray<unknown>;
	readonly unhandledErrors?: ReadonlyArray<unknown>;
	readonly totalSpecs?: number;
}

describe("run_tests result shaping (issue #336 characterization)", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Layer.Success<typeof TestLayer>, Layer.Error<typeof TestLayer>>;
	let root: string;
	const createVitestMock = vi.fn();
	const originalLoad = vitestLoader.load;
	const originalResolve = vitestLoader.resolveEntry;

	const arrange = (run: FakeRun = {}) => {
		const start = vi.fn(async () => ({
			testModules: run.testModules ?? [],
			unhandledErrors: run.unhandledErrors ?? [],
		}));
		createVitestMock.mockResolvedValue({
			start,
			state: { getFiles: () => [] },
			globTestSpecifications: async () => Array.from({ length: run.totalSpecs ?? 0 }),
			close: async () => undefined,
		});
		return start;
	};

	beforeEach(() => {
		runtime = ManagedRuntime.make(TestLayer);
		root = realpathSync(mkdtempSync(join(tmpdir(), "va-run-tests-shaping-")));
		mkdirSync(join(root, ".git"));
		writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
		createVitestMock.mockReset();
		vitestLoader.resolveEntry = () => "vitest/node";
		vitestLoader.load = (async () => ({
			createVitest: (...args: unknown[]) => createVitestMock(...args),
		})) as unknown as typeof vitestLoader.load;
	});

	afterEach(async () => {
		await runtime.dispose();
		rmSync(root, { recursive: true, force: true });
		vitestLoader.load = originalLoad;
		vitestLoader.resolveEntry = originalResolve;
		delete (globalThis as Record<symbol, unknown>)[DISCOVERY_LAST_SCAN_SYMBOL];
	});

	const run = (params: ToolParams<"run_tests">) =>
		makeToolCaller(runtime, McpSession.layerTest({ cwd: root }))("run_tests", params);

	describe("scope derivation", () => {
		it("rejects an unsafe file argument as an error envelope without starting Vitest", async () => {
			arrange();
			const result = await run({ files: ["a.test.ts; rm -rf /"] });
			expect(result).toEqual({ kind: "error", message: "Unsafe argument rejected: a.test.ts; rm -rf /" });
			expect(createVitestMock).not.toHaveBeenCalled();
		});

		it("rejects an unsafe project argument", async () => {
			arrange();
			const result = await run({ project: "p|x" });
			expect(result).toEqual({ kind: "error", message: "Unsafe argument rejected: p|x" });
		});

		it.each([
			["all", { all: ["ok", "$(x)"] }],
			["any", { any: ["`x`"] }],
			["none", { none: ["a;b"] }],
		])("rejects an unsafe %s tag value", async (_label, tags) => {
			arrange();
			const result = await run({ tags });
			expect(result.kind).toBe("error");
			expect(createVitestMock).not.toHaveBeenCalled();
		});

		it("forwards the composed tag expression, project and files to Vitest", async () => {
			const start = arrange({ unhandledErrors: [new Error("boom")] });
			await run({ files: ["a.test.ts"], project: "p", tags: { all: ["int"], none: ["slow"] } });
			const [options] = createVitestMock.mock.calls[0] as [Record<string, unknown>];
			expect(options.project).toBe("p");
			expect(options.tagsFilter).toEqual(["int and not slow"]);
			expect(start).toHaveBeenCalledWith(["a.test.ts"]);
		});

		it("forwards no tagsFilter and no start files for an unfiltered call", async () => {
			const start = arrange();
			await run({});
			const [options] = createVitestMock.mock.calls[0] as [Record<string, unknown>];
			expect("tagsFilter" in options).toBe(false);
			expect("project" in options).toBe(false);
			expect(start).toHaveBeenCalledWith(undefined);
		});
	});

	describe("no-match discrimination", () => {
		it("returns no-match for a filtered call that collected nothing, echoing the resolved filter", async () => {
			arrange();
			const tags = { any: ["unit", "int"] };
			const result = await run({ files: ["x.test.ts"], project: "p", tags });
			expect(result).toEqual({
				kind: "no-match",
				projectRoot: root,
				filter: { project: "p", files: ["x.test.ts"], tags, resolvedExpression: "(unit or int)" },
			});
		});

		it("treats an all-empty tag filter as no filter: an empty run is ok, not no-match", async () => {
			arrange();
			const result = await run({ tags: { all: [] } });
			expect(result.kind).toBe("ok");
		});

		it("returns ok (not no-match) for an unfiltered call that collected nothing", async () => {
			arrange();
			const result = await run({});
			expect(result.kind).toBe("ok");
		});

		it("returns ok (not no-match) for a filtered empty run that carried unhandled errors", async () => {
			arrange({ unhandledErrors: [new Error("boom")] });
			const result = await run({ files: ["x.test.ts"] });
			expect(result.kind).toBe("ok");
		});
	});

	describe("ok payload", () => {
		it("echoes an unscoped run: null scope fields, null scopedNote, no project key, empty classifications", async () => {
			arrange();
			const result = await run({});
			expect(result.kind).toBe("ok");
			if (result.kind !== "ok") return;
			expect(result.projectRoot).toBe(root);
			expect(result.scope).toEqual({ project: null, files: [], tags: null });
			expect("project" in result).toBe(false);
			expect(result.scopedNote).toBeNull();
			expect(result.classifications).toEqual({});
			expect(result.discoveryLastScannedAt).toBeNull();
		});

		it("echoes a scoped run verbatim with the scoped-coverage note and the top-level project", async () => {
			arrange({ unhandledErrors: [new Error("boom")], totalSpecs: 3 });
			const tags = { none: ["slow"] };
			const result = await run({ files: ["a.test.ts"], project: "p", tags });
			expect(result.kind).toBe("ok");
			if (result.kind !== "ok") return;
			expect(result.project).toBe("p");
			expect(result.scope).toEqual({ project: "p", files: ["a.test.ts"], tags });
			expect(result.scopedNote).toBe(formatScopedCoverageNote(0, 3));
			expect(result.report.unhandledErrors?.[0]?.message).toBe("boom");
		});

		it("reports the discovery last-scan timestamp from the process-global slot", async () => {
			arrange();
			(globalThis as Record<symbol, unknown>)[DISCOVERY_LAST_SCAN_SYMBOL] = "2026-09-29T00:00:00.000Z";
			const result = await run({});
			expect(result.kind).toBe("ok");
			if (result.kind !== "ok") return;
			expect(result.discoveryLastScannedAt).toBe("2026-09-29T00:00:00.000Z");
		});
	});
});

describe("run_tests pure shaping helpers (issue #336)", () => {
	const scopeOf = (input: Parameters<typeof deriveRunScope>[0]): RunScope => {
		const derived = deriveRunScope(input);
		if (Result.isFailure(derived)) throw new Error(`unexpected refusal: ${derived.failure}`);
		return derived.success;
	};

	describe("deriveRunScope", () => {
		it("derives an unfiltered scope from an empty input", () => {
			expect(scopeOf({})).toEqual({
				files: [],
				project: undefined,
				tags: undefined,
				resolvedExpression: null,
				hasFilter: false,
			});
		});

		it.each([
			["files", { files: ["a.test.ts"] }],
			["project", { project: "p" }],
			["tags", { tags: { any: ["unit"] } }],
		])("counts %s alone as a filter", (_label, input) => {
			expect(scopeOf(input).hasFilter).toBe(true);
		});

		it("does not count an all-empty tag filter, but keeps it verbatim", () => {
			const tags = { all: [], none: [] };
			const scope = scopeOf({ tags });
			expect(scope.hasFilter).toBe(false);
			expect(scope.resolvedExpression).toBeNull();
			expect(scope.tags).toBe(tags);
		});

		it("composes the tag expression", () => {
			expect(scopeOf({ tags: { all: ["int"], none: ["slow"] } }).resolvedExpression).toBe("int and not slow");
		});

		it.each([
			["file", { files: ["ok.ts", "x;y"] }, "x;y"],
			["project", { project: "a&b" }, "a&b"],
			["all tag", { tags: { all: ["$x"] } }, "$x"],
			["any tag", { tags: { any: ["<x>"] } }, "<x>"],
			["none tag", { tags: { none: ["#x"] } }, "#x"],
		])("refuses an unsafe %s with the tool's message", (_label, input, bad) => {
			const derived = deriveRunScope(input);
			expect(Result.isFailure(derived)).toBe(true);
			if (!Result.isFailure(derived)) return;
			expect(derived.failure).toBe(`Unsafe argument rejected: ${bad}`);
		});
	});

	describe("isNoMatch", () => {
		const filtered = scopeOf({ files: ["a.test.ts"] });
		it("is true only for a filtered run with no modules and no unhandled errors", () => {
			expect(isNoMatch(filtered, 0, 0)).toBe(true);
		});
		it("is false for an unfiltered empty run", () => {
			expect(isNoMatch(scopeOf({}), 0, 0)).toBe(false);
		});
		it("is false when a module was collected", () => {
			expect(isNoMatch(filtered, 1, 0)).toBe(false);
		});
		it("is false when an unhandled error was raised", () => {
			expect(isNoMatch(filtered, 0, 1)).toBe(false);
		});
	});

	it("toNoMatch echoes the resolved filter and root, nulling absent fields", () => {
		expect(toNoMatch(scopeOf({ files: ["a.test.ts"] }), "/repo")).toEqual({
			kind: "no-match",
			projectRoot: "/repo",
			filter: { project: null, files: ["a.test.ts"], tags: null, resolvedExpression: null },
		});
	});

	describe("toOkPayload", () => {
		const report = { reason: "passed" } as unknown as AgentReport;

		it("omits the top-level project and defaults classifications and scan time when absent", () => {
			const payload = toOkPayload({
				scope: scopeOf({}),
				projectRoot: "/repo",
				report,
				classifications: undefined,
				discoveryLastScannedAt: undefined,
				scopedNote: null,
			});
			expect(payload).toEqual({
				kind: "ok",
				projectRoot: "/repo",
				scope: { project: null, files: [], tags: null },
				report,
				classifications: {},
				discoveryLastScannedAt: null,
				scopedNote: null,
			});
			expect("project" in payload).toBe(false);
		});

		it("echoes project, scope, classifications, scan time and scoped note", () => {
			const tags = { any: ["unit"] };
			const payload = toOkPayload({
				scope: scopeOf({ files: ["a.test.ts"], project: "p", tags }),
				projectRoot: "/repo",
				report,
				classifications: new Map([["t", "flaky"]]),
				discoveryLastScannedAt: "2026-09-29T00:00:00.000Z",
				scopedNote: "note",
			});
			expect(payload).toEqual({
				kind: "ok",
				project: "p",
				projectRoot: "/repo",
				scope: { project: "p", files: ["a.test.ts"], tags },
				report,
				classifications: { t: "flaky" },
				discoveryLastScannedAt: "2026-09-29T00:00:00.000Z",
				scopedNote: "note",
			});
		});
	});
});

/**
 * The 18 read-only tools over the in-process stdio harness: each is
 * listed with the read-only annotation set, and a representative
 * `tools/call` returns the typed `structuredContent` plus the markdown
 * (or JSON) text channel. Assertions mirror the tRPC-caller tests in
 * `router.test.ts` and the per-tool suites they replace.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { HarnessOptions, McpHarness, McpToolDescriptor } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";
import { SEED_ERROR_FULL_NAME, SEED_ERROR_PROJECT, SEED_PROJECT, seedReadonlyFixture } from "./utils/seed.js";

interface CallToolResult {
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

const withHarness = <A>(f: (harness: McpHarness) => Effect.Effect<A>, options?: HarnessOptions): Promise<A> =>
	Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness(options), f)));

const SEEDED: HarnessOptions = { seed: seedReadonlyFixture };

const call = (name: string, args: unknown, options?: HarnessOptions): Promise<CallToolResult> =>
	withHarness((h) => h.initialize().pipe(Effect.andThen(h.callTool(name, args))), options) as Promise<CallToolResult>;

const listTools = (): Promise<ReadonlyArray<McpToolDescriptor>> =>
	withHarness((h) => h.initialize().pipe(Effect.andThen(h.listTools)));

const text = (result: CallToolResult): string => result.content[0]?.text ?? "";

const READONLY_TOOLS = [
	"test_status",
	"test_overview",
	"test_coverage",
	"test_history",
	"test_trends",
	"test_errors",
] as const;

/** Result schemas that are a single `Schema.Struct` — these list an `outputSchema`. */
const STRUCT_RESULT_TOOLS = ["test_history", "test_errors"] as const;
/** Result schemas that are a `Schema.Union` — no `outputSchema` (a `oneOf` root is not `type: object`). */
const UNION_RESULT_TOOLS = ["test_status", "test_overview", "test_coverage", "test_trends"] as const;

describe("read-only tools: tools/list", () => {
	it("lists every read-only tool with readOnly/idempotent true and destructive/openWorld false", async () => {
		const tools = await listTools();
		for (const name of READONLY_TOOLS) {
			const tool = tools.find((t) => t.name === name);
			expect(tool, `${name} listed`).toBeDefined();
			expect(tool?.annotations, `${name} annotations`).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
				idempotentHint: true,
			});
			expect(typeof tool?.title, `${name} title`).toBe("string");
			expect(tool?.description, `${name} description`).toMatch(/^Use /);
			expect(tool?.inputSchema.type, `${name} inputSchema.type`).toBe("object");
		}
	});

	it("advertises an object outputSchema for struct results and none for union results (MCP requires type: object)", async () => {
		const tools = await listTools();
		const byName = new Map(tools.map((t) => [t.name, t]));
		for (const name of STRUCT_RESULT_TOOLS) {
			expect(byName.get(name)?.outputSchema?.type, `${name} outputSchema`).toBe("object");
		}
		for (const name of UNION_RESULT_TOOLS) {
			expect(byName.get(name)?.outputSchema, `${name} outputSchema`).toBeUndefined();
		}
	});
});

describe("test_status", () => {
	it("returns dataAvailable=false with the cold-start text on an empty DB", async () => {
		const result = await call("test_status", {});
		expect(result.isError).toBe(false);
		expect(result.structuredContent).toEqual({ dataAvailable: false, reason: "no_manifest" });
		expect(text(result)).toBe("No test data available. Run tests first.");
	});

	it("returns the per-project entries and the markdown after seeding", async () => {
		const result = await call("test_status", { project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.dataAvailable).toBe(true);
		expect(result.structuredContent?.projectFilter).toBe(SEED_PROJECT);
		const entries = result.structuredContent?.entries as Array<{ project: string; lastResult: string }>;
		expect(entries.map((e) => e.project)).toEqual([SEED_PROJECT]);
		expect(entries[0]?.lastResult).toBe("passed");
		expect(text(result)).toContain("# Test Status");
		expect(text(result)).toContain(`**${SEED_PROJECT}**`);
	});

	it("reports project_filter_empty for an unknown project", async () => {
		const result = await call("test_status", { project: "nope" }, SEEDED);
		expect(result.structuredContent).toEqual({
			dataAvailable: false,
			reason: "project_filter_empty",
			projectFilter: "nope",
		});
		expect(text(result)).toBe("No test data found for project `nope`. Run tests first.");
	});
});

describe("test_overview", () => {
	it("returns dataAvailable=false on an empty DB", async () => {
		const result = await call("test_overview", {});
		expect(result.structuredContent).toEqual({ dataAvailable: false, reason: "no_runs" });
		expect(text(result)).toBe("No test data available. Run tests first.");
	});

	it("returns the run metrics and the markdown tables after seeding", async () => {
		const result = await call("test_overview", { project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.dataAvailable).toBe(true);
		const runs = result.structuredContent?.runs as Array<{ project: string; total: number; passed: number }>;
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ project: SEED_PROJECT, total: 5, passed: 5, failed: 0, skipped: 0 });
		expect(text(result)).toContain("# Test Overview");
		expect(text(result)).toContain("| Total | 5 |");
	});
});

describe("test_coverage", () => {
	it("returns dataAvailable=false when no coverage exists", async () => {
		const result = await call("test_coverage", {});
		expect(result.structuredContent).toEqual({ dataAvailable: false, project: "default" });
		expect(text(result)).toBe("No coverage data available. Run tests with coverage enabled.");
	});

	it("returns the coverage report after seeding", async () => {
		const result = await call("test_coverage", { project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.dataAvailable).toBe(true);
		expect(result.structuredContent?.project).toBe(SEED_PROJECT);
		const coverage = result.structuredContent?.coverage as { totals: { statements: number } };
		expect(coverage.totals.statements).toBeGreaterThanOrEqual(0);
		expect(text(result)).toContain("# Coverage Report");
		expect(text(result)).toContain("## Totals");
	});
});

describe("test_history", () => {
	it("returns the project envelope for a positive integer limit", async () => {
		const result = await call("test_history", { project: SEED_PROJECT, limit: 5 }, SEEDED);
		expect(result.isError).toBe(false);
		expect(result.structuredContent?.project).toBe(SEED_PROJECT);
		expect(result.structuredContent).toHaveProperty("flaky");
		expect(result.structuredContent).toHaveProperty("persistent");
		expect(result.structuredContent).toHaveProperty("recovered");
		expect(text(result)).toMatch(/^# Test History: default|^No history data available for project `default`/);
	});

	it("rejects a non-positive or fractional limit instead of silently returning empty history", async () => {
		for (const limit of [0, -1, 2.5]) {
			const result = await call("test_history", { project: SEED_PROJECT, limit });
			expect(result.isError, `limit=${limit} should be rejected`).toBe(true);
			expect(result.structuredContent, `limit=${limit} carries no payload`).toBeUndefined();
		}
	});

	it("rejects a missing project", async () => {
		const result = await call("test_history", {});
		expect(result.isError).toBe(true);
	});
});

describe("test_trends", () => {
	it("returns dataAvailable=false for a project with no trend entries", async () => {
		const result = await call("test_trends", { project: "nope" });
		expect(result.structuredContent).toEqual({ dataAvailable: false, project: "nope" });
		expect(text(result)).toContain("No trend data available for project `nope`");
	});

	it("returns the trend record and the markdown after seeding", async () => {
		const result = await call("test_trends", { project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.dataAvailable).toBe(true);
		const trends = result.structuredContent?.trends as { entries: Array<{ direction: string }> };
		expect(trends.entries).toHaveLength(1);
		expect(trends.entries[0]?.direction).toBe("improving");
		expect(text(result)).toContain(`# Coverage Trends: ${SEED_PROJECT}`);
		expect(text(result)).toContain("## Latest Coverage");
	});
});

describe("test_errors", () => {
	it("returns an empty, counted payload for a project with no errors", async () => {
		const result = await call("test_errors", { project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent).toEqual({ project: SEED_PROJECT, count: 0, errors: [] });
		expect(text(result)).toBe(`No errors found for project \`${SEED_PROJECT}\`.`);
	});

	it("returns each error row with its annotations and the cite-able ids", async () => {
		const result = await call("test_errors", { project: SEED_ERROR_PROJECT }, SEEDED);
		expect(result.structuredContent?.count).toBe(2);
		const errors = result.structuredContent?.errors as Array<{
			id: number;
			scope: string;
			testFullName: string | null;
			annotations: Array<{ type: string; message: string }>;
		}>;
		const testScoped = errors.find((e) => e.scope === "test");
		const moduleScoped = errors.find((e) => e.scope === "module");
		expect(testScoped?.testFullName).toBe(SEED_ERROR_FULL_NAME);
		expect(testScoped?.annotations).toEqual([
			{ type: "issues", message: "flaky under load", location: { file: "src/failing.test.ts", line: 4, column: 1 } },
		]);
		expect(moduleScoped?.annotations).toEqual([]);
		expect(text(result)).toContain(`# Test Errors — ${SEED_ERROR_PROJECT}`);
		expect(text(result)).toContain(`citedTestErrorId: ${testScoped?.id}`);
		expect(text(result)).toContain("- [issues] flaky under load");
	});

	it("echoes the errorName filter", async () => {
		const result = await call("test_errors", { project: SEED_ERROR_PROJECT, errorName: "SyntaxError" }, SEEDED);
		expect(result.structuredContent?.errorName).toBe("SyntaxError");
		expect(result.structuredContent?.count).toBe(1);
	});
});

/**
 * The 18 read-only tools over the in-process stdio harness: each is
 * listed with the read-only annotation set, and a representative
 * `tools/call` returns the typed `structuredContent` plus the markdown
 * (or JSON) text channel. Assertions mirror the direct-caller tests in
 * `tool-handlers.test.ts` and the per-tool suites they replace.
 */

import { DataStore } from "@vitest-agent/engine";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { HarnessOptions, McpHarness, McpToolDescriptor } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";
import {
	SEED_CHAT_ID,
	SEED_COMMIT_SHA,
	SEED_ERROR_FULL_NAME,
	SEED_ERROR_PROJECT,
	SEED_MODULE,
	SEED_PROJECT,
	SEED_SETTINGS_HASH,
	SEED_SIGNATURE_HASH,
	SEED_SOURCE_FILE,
	seedReadonlyFixture,
} from "./utils/seed.js";

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
	"file_coverage",
	"settings_list",
	"cache_health",
	"configure",
	"commit_changes",
	"turn_search",
	"failure_signature_get",
	"acceptance_metrics",
	"triage_brief",
	"wrapup_prompt",
	"inventory",
	"test",
] as const;

/** Result schemas that are a single `Schema.Struct` — these list an `outputSchema`. */
const STRUCT_RESULT_TOOLS = [
	"test_history",
	"test_errors",
	"settings_list",
	"commit_changes",
	"turn_search",
	"acceptance_metrics",
	"triage_brief",
	"wrapup_prompt",
] as const;
/** Result schemas that are a `Schema.Union` — no `outputSchema` (a `oneOf` root is not `type: object`). */
const UNION_RESULT_TOOLS = [
	"test_status",
	"test_overview",
	"test_coverage",
	"test_trends",
	"file_coverage",
	"cache_health",
	"configure",
	"failure_signature_get",
	"inventory",
	"test",
] as const;

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

describe("test_history: served schema and single-test scoping (was server-test-history-schema)", () => {
	const HISTORY_PROJECT = "served-history-proj";
	const seedHistory: HarnessOptions = {
		seed: Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("served-history-hash", { vitestVersion: "3.2.0" }, {});
			const runId = yield* store.writeRun({
				invocationId: "inv-served-history",
				project: HISTORY_PROJECT,
				settingsHash: "served-history-hash",
				timestamp: "2026-03-26T00:00:00.000Z",
				commitSha: null,
				branch: null,
				reason: "passed",
				duration: 100,
				total: 2,
				passed: 2,
				failed: 0,
				skipped: 0,
				scoped: false,
			});
			for (const [fullName, modulePath] of [
				["Suite > one", "src/a.test.ts"],
				["Suite > two", "src/b.test.ts"],
			] as const) {
				yield* store.writeHistory(
					HISTORY_PROJECT,
					fullName,
					modulePath,
					runId,
					"2026-03-26T00:00:00.000Z",
					"passed",
					10,
					false,
					0,
					null,
				);
			}
		}).pipe(Effect.orDie),
	};

	it("declares testName, modulePath, and limit on the served inputSchema", async () => {
		const tool = (await listTools()).find((t) => t.name === "test_history");
		const properties = tool?.inputSchema.properties as Record<string, unknown>;
		expect(Object.keys(properties)).toEqual(expect.arrayContaining(["project", "testName", "modulePath", "limit"]));
	});

	it("forwards testName through to a real single-test result", async () => {
		const result = await call("test_history", { project: HISTORY_PROJECT, testName: "Suite > one" }, seedHistory);
		expect(result.isError ?? false).toBe(false);
		const history = result.structuredContent?.history as { tests: Array<{ fullName: string }> };
		expect(history.tests).toHaveLength(1);
		expect(history.tests[0]?.fullName).toBe("Suite > one");
	});

	it("rejects a non-numeric limit naming the field, and still accepts a positive integer", async () => {
		const rejected = await call("test_history", { project: HISTORY_PROJECT, limit: "abc" }, seedHistory);
		expect(rejected.isError).toBe(true);
		expect(text(rejected)).toMatch(/limit/i);
		const accepted = await call("test_history", { project: HISTORY_PROJECT, limit: 3 }, seedHistory);
		expect(accepted.isError ?? false).toBe(false);
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

describe("file_coverage", () => {
	it("returns dataAvailable=false when no coverage exists", async () => {
		const result = await call("file_coverage", { filePath: SEED_SOURCE_FILE });
		expect(result.structuredContent).toEqual({ dataAvailable: false, filePath: SEED_SOURCE_FILE });
		expect(text(result)).toBe("No coverage data available. Run tests with coverage enabled.");
	});

	it("returns dataAvailable=true for the tracked project", async () => {
		const result = await call("file_coverage", { filePath: SEED_SOURCE_FILE, project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.dataAvailable).toBe(true);
		expect(result.structuredContent?.filePath).toBe(SEED_SOURCE_FILE);
		expect(text(result)).toContain(`# Coverage: \`${SEED_SOURCE_FILE}\``);
	});

	it("returns matched=false for an unknown file", async () => {
		const result = await call("file_coverage", { filePath: "nonexistent.ts", project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.dataAvailable).toBe(true);
		expect(result.structuredContent?.matched).toBe(false);
		expect(result.structuredContent?.filePath).toBe("nonexistent.ts");
		expect(text(result)).toContain("This file is not in the low-coverage list.");
	});

	it("rejects a missing filePath", async () => {
		const result = await call("file_coverage", {});
		expect(result.isError).toBe(true);
	});
});

describe("settings_list", () => {
	it("returns count=0 and the cold-start text on an empty DB", async () => {
		const result = await call("settings_list", {});
		expect(result.structuredContent).toEqual({ count: 0, settings: [] });
		expect(text(result)).toBe("No settings found. Run tests first.");
	});

	it("returns count and the captured settings rows after seeding", async () => {
		const result = await call("settings_list", {}, SEEDED);
		expect(result.structuredContent?.count).toBeGreaterThan(0);
		const settings = result.structuredContent?.settings as Array<{ hash: string }>;
		expect(settings[0]?.hash.length).toBeGreaterThan(0);
		expect(text(result)).toContain("## Settings");
		expect(text(result)).toContain(`| ${SEED_SETTINGS_HASH} |`);
	});

	it("rejects an unknown parameter", async () => {
		const result = await call("settings_list", { bogus: 1 });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("Unrecognized parameter(s): bogus");
	});
});

describe("cache_health", () => {
	it("returns manifestPresent=false on an empty DB", async () => {
		const result = await call("cache_health", {});
		expect(result.structuredContent).toEqual({ manifestPresent: false });
		expect(text(result)).toContain("**Manifest:** not found");
	});

	it("returns the manifest, ageMs and stale after seeding", async () => {
		const result = await call("cache_health", {}, SEEDED);
		expect(result.structuredContent?.manifestPresent).toBe(true);
		expect(typeof result.structuredContent?.ageMs).toBe("number");
		expect(typeof result.structuredContent?.stale).toBe("boolean");
		const manifest = result.structuredContent?.manifest as { projects: Array<{ project: string }> };
		expect(manifest.projects.map((p) => p.project)).toEqual(expect.arrayContaining([SEED_PROJECT]));
		expect(text(result)).toContain("# Cache Health");
		expect(text(result)).toContain("**Manifest:** present");
	});
});

describe("configure", () => {
	it("returns found=false with source=latest on an empty DB", async () => {
		const result = await call("configure", {});
		expect(result.structuredContent).toEqual({ found: false, source: "latest" });
		expect(text(result)).toContain("No settings captured yet. Run tests first.");
	});

	it("returns the latest settings when no hash is provided", async () => {
		const result = await call("configure", {}, SEEDED);
		expect(result.structuredContent?.found).toBe(true);
		expect(result.structuredContent?.source).toBe("latest");
		const settings = result.structuredContent?.settings as { hash: string } | undefined;
		expect(settings?.hash).toBe(SEED_SETTINGS_HASH);
		expect(text(result)).toContain(`# Settings — \`${SEED_SETTINGS_HASH}\``);
	});

	it("echoes the requested hash when it matches nothing", async () => {
		const result = await call("configure", { settingsHash: "nope" }, SEEDED);
		expect(result.structuredContent).toEqual({ found: false, source: "requested", requestedHash: "nope" });
		expect(text(result)).toBe("No settings found for hash `nope`.");
	});
});

describe("commit_changes", () => {
	it("returns count=0 and an empty commits[] on an empty DB", async () => {
		const result = await call("commit_changes", {});
		expect(result.structuredContent).toEqual({ count: 0, commits: [] });
		expect(text(result)).toContain("No commits recorded yet.");
	});

	it("returns the recorded commit by sha and echoes filterSha", async () => {
		const result = await call("commit_changes", { sha: SEED_COMMIT_SHA }, SEEDED);
		expect(result.structuredContent?.filterSha).toBe(SEED_COMMIT_SHA);
		expect(result.structuredContent?.count).toBe(1);
		const commits = result.structuredContent?.commits as Array<{ sha: string; message: string | null }>;
		expect(commits[0]).toMatchObject({ sha: SEED_COMMIT_SHA, message: "feat: seed commit" });
		expect(text(result)).toContain(`## ${SEED_COMMIT_SHA.slice(0, 8)} feat: seed commit`);
	});
});

describe("turn_search", () => {
	it("returns count=0 and 'No turns matched.' on an empty DB", async () => {
		const result = await call("turn_search", {});
		expect(result.structuredContent).toEqual({ count: 0, turns: [] });
		expect(text(result)).toBe("No turns matched.");
	});

	it("returns the seeded turn filtered by type", async () => {
		const result = await call("turn_search", { type: "user_prompt", limit: 10 }, SEEDED);
		expect(result.structuredContent?.count).toBe(1);
		const turns = result.structuredContent?.turns as Array<{ type: string; turnNo: number }>;
		expect(turns[0]?.type).toBe("user_prompt");
		expect(text(result)).toContain("# Turns");
		expect(text(result)).toContain("type=user_prompt");
	});

	it("rejects an unknown turn type", async () => {
		const result = await call("turn_search", { type: "bogus" });
		expect(result.isError).toBe(true);
	});
});

describe("failure_signature_get", () => {
	it("returns found=true with the matching signatureHash so callers preserve it under clipping", async () => {
		const result = await call("failure_signature_get", { hash: SEED_SIGNATURE_HASH }, SEEDED);
		expect(result.structuredContent?.found).toBe(true);
		expect(result.structuredContent?.signatureHash).toBe(SEED_SIGNATURE_HASH);
		expect(result.structuredContent?.occurrenceCount).toBe(1);
		expect(text(result)).toContain(`# Failure Signature \`${SEED_SIGNATURE_HASH}\``);
	});

	it("returns found=false with the requested hash when nothing matches", async () => {
		const result = await call("failure_signature_get", { hash: "0000000000000000" });
		expect(result.structuredContent).toEqual({ found: false, requestedHash: "0000000000000000" });
		expect(text(result)).toBe("No failure signature found with hash=0000000000000000.");
	});

	it("rejects a missing hash", async () => {
		const result = await call("failure_signature_get", {});
		expect(result.isError).toBe(true);
	});
});

describe("acceptance_metrics", () => {
	it("returns the four metric buckets and the numbered markdown", async () => {
		const result = await call("acceptance_metrics", {});
		expect(Object.keys(result.structuredContent ?? {}).sort()).toEqual([
			"antiPatternDetectionRate",
			"complianceHookResponsiveness",
			"orientationUsefulness",
			"phaseEvidenceIntegrity",
		]);
		const bucket = result.structuredContent?.phaseEvidenceIntegrity as { total: number; ratio: number };
		expect(bucket.total).toBe(0);
		expect(text(result)).toContain("# Acceptance metrics");
		expect(text(result)).toContain("1. Phase-evidence integrity: no data — target ≥80%");
	});
});

describe("triage_brief", () => {
	it("renders either the cold-start hint or a real triage brief on an empty DB", async () => {
		const result = await call("triage_brief", {});
		expect(typeof result.structuredContent?.hasContent).toBe("boolean");
		expect(result.structuredContent?.markdown).toMatch(/No orientation signal|orientation triage|Recent Test Runs/i);
		expect(text(result)).toBe(result.structuredContent?.markdown);
	});

	it("includes content when test runs are seeded and renders markdown as the text channel", async () => {
		const result = await call("triage_brief", { project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.hasContent).toBe(true);
		const markdown = result.structuredContent?.markdown as string;
		expect(markdown.length).toBeGreaterThan(0);
		expect(text(result)).toBe(markdown);
	});
});

describe("wrapup_prompt", () => {
	it("returns hasContent=false for an unknown session", async () => {
		const result = await call("wrapup_prompt", {});
		expect(result.structuredContent?.hasContent).toBe(false);
		expect(result.structuredContent?.kind).toBe("session_end");
		expect(result.structuredContent?.markdown).toMatch(/Nothing to wrap up|no recent activity/i);
		expect(text(result)).toBe(result.structuredContent?.markdown);
	});

	it("emits a failure-prompt nudge for the user_prompt_nudge variant", async () => {
		const result = await call("wrapup_prompt", {
			kind: "user_prompt_nudge",
			userPromptHint: "fix the broken test in foo.test.ts",
		});
		expect(result.structuredContent?.kind).toBe("user_prompt_nudge");
		expect(text(result)).toContain("test_history");
		expect(text(result)).toContain("failure_signature_get");
	});

	it("rejects an unknown kind", async () => {
		const result = await call("wrapup_prompt", { kind: "bogus" });
		expect(result.isError).toBe(true);
	});
});

describe("inventory", () => {
	it("serves a oneOf discriminated on kind", async () => {
		const tools = await listTools();
		const inventory = tools.find((t) => t.name === "inventory");
		expect(inventory?.inputSchema["x-discriminator"]).toBe("kind");
		expect(Array.isArray(inventory?.inputSchema.oneOf)).toBe(true);
	});

	it("project returns the inventoryKind discriminant", async () => {
		const result = await call("inventory", { kind: "project" }, SEEDED);
		expect(result.structuredContent?.inventoryKind).toBe("project");
		expect(result.structuredContent?.count).toBe(2);
		expect(text(result)).toContain("## Projects");
	});

	it("module returns the inventoryKind discriminant", async () => {
		const result = await call("inventory", { kind: "module", project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.inventoryKind).toBe("module");
		expect(result.structuredContent?.count).toBe(1);
		expect(text(result)).toContain(`| ${SEED_MODULE} |`);
	});

	it("suite returns the inventoryKind discriminant", async () => {
		const result = await call("inventory", { kind: "suite", project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.inventoryKind).toBe("suite");
		expect(text(result)).toContain("## Suites");
	});

	it("session lists the seeded session and looks one up by id", async () => {
		const list = await call("inventory", { kind: "session" }, SEEDED);
		expect(list.structuredContent?.inventoryKind).toBe("session_list");
		const sessions = list.structuredContent?.sessions as Array<{ id: number; chatId: string }>;
		expect(sessions.map((s) => s.chatId)).toEqual([SEED_CHAT_ID]);
		const missing = await call("inventory", { kind: "session", id: 9999 }, SEEDED);
		expect(missing.structuredContent).toEqual({ inventoryKind: "session_detail", found: false, id: 9999 });
		expect(text(missing)).toBe("No session with id=9999.");
	});

	it("tag unscoped returns tag_unscoped with count 0 when no tags are recorded", async () => {
		const result = await call("inventory", { kind: "tag" }, SEEDED);
		expect(result.structuredContent).toEqual({ inventoryKind: "tag_unscoped", count: 0, tags: [] });
		expect(text(result)).toBe("No tags recorded. Run run_tests({}) to populate.");
	});

	it("rejects an unknown kind and a key that belongs to another variant", async () => {
		const unknownKind = await call("inventory", { kind: "bogus" });
		expect(unknownKind.isError).toBe(true);
		const foreignKey = await call("inventory", { kind: "project", module: "x" });
		expect(foreignKey.isError).toBe(true);
		expect(text(foreignKey)).toContain("Unrecognized parameter(s): module");
	});
});

describe("test", () => {
	it("serves a oneOf discriminated on action", async () => {
		const tools = await listTools();
		const test = tools.find((t) => t.name === "test");
		expect(test?.inputSchema["x-discriminator"]).toBe("action");
	});

	it("list returns a structured groups envelope", async () => {
		const result = await call("test", { action: "list", project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.action).toBe("list");
		expect(result.structuredContent?.count).toBe(2);
		expect(text(result)).toContain("utils > adds numbers");
	});

	it("get returns the structured test row for a known test", async () => {
		const result = await call(
			"test",
			{ action: "get", fullName: "utils > adds numbers", project: SEED_PROJECT },
			SEEDED,
		);
		expect(result.structuredContent?.action).toBe("get");
		expect(result.structuredContent?.found).toBe(true);
		const row = result.structuredContent?.test as { fullName: string; state: string; module: string };
		expect(row).toMatchObject({ fullName: "utils > adds numbers", state: "passed", module: SEED_MODULE });
	});

	it("get refuses to guess an ambiguous fullName without modulePath, and forwards modulePath to the requested variant (was server-test-get-modulepath)", async () => {
		const PROJECT = "served-ambiguous-proj";
		const FULL_NAME = "Suite > shared";
		const FIRST_MODULE = "src/first.test.ts";
		const SECOND_MODULE = "src/second.test.ts";
		const seedAmbiguous: HarnessOptions = {
			seed: Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSettings("served-ambiguous-hash", { vitestVersion: "3.2.0" }, {});
				const runId = yield* store.writeRun({
					invocationId: "inv-served-ambiguous",
					project: PROJECT,
					settingsHash: "served-ambiguous-hash",
					timestamp: "2026-03-28T00:00:00.000Z",
					commitSha: null,
					branch: null,
					reason: "failed",
					duration: 100,
					total: 2,
					passed: 1,
					failed: 1,
					skipped: 0,
					scoped: false,
				});
				for (const [modulePath, state] of [
					[FIRST_MODULE, "passed"],
					[SECOND_MODULE, "failed"],
				] as const) {
					const fileId = yield* store.ensureFile(modulePath);
					const [moduleId] = yield* store.writeModules(runId, [
						{ fileId, relativeModuleId: modulePath, state, duration: 20 },
					]);
					yield* store.writeSuites(moduleId, [{ name: "Suite", fullName: "Suite", state }]);
					yield* store.writeTestCases(moduleId, [{ name: "shared", fullName: FULL_NAME, state, duration: 5 }]);
				}
			}).pipe(Effect.orDie),
		};
		const tool = (await listTools()).find((t) => t.name === "test") as McpToolDescriptor;
		const getMember = (
			tool.inputSchema.oneOf as Array<{ properties: Record<string, { const?: string; enum?: string[] }> }>
		).find((m) => m.properties.action?.const === "get" || m.properties.action?.enum?.[0] === "get");
		expect(Object.keys(getMember?.properties ?? {})).toContain("modulePath");

		const ambiguous = await call("test", { action: "get", fullName: FULL_NAME, project: PROJECT }, seedAmbiguous);
		expect(ambiguous.structuredContent).toMatchObject({
			found: false,
			ambiguous: true,
			candidateModules: [FIRST_MODULE, SECOND_MODULE],
		});
		expect(text(ambiguous)).toContain(FIRST_MODULE);
		expect(text(ambiguous)).toContain(SECOND_MODULE);

		const second = await call(
			"test",
			{ action: "get", fullName: FULL_NAME, project: PROJECT, modulePath: SECOND_MODULE },
			seedAmbiguous,
		);
		expect(second.structuredContent?.found).toBe(true);
		expect(second.structuredContent?.test).toMatchObject({ module: SECOND_MODULE, state: "failed" });
		const first = await call(
			"test",
			{ action: "get", fullName: FULL_NAME, project: PROJECT, modulePath: FIRST_MODULE },
			seedAmbiguous,
		);
		expect(first.structuredContent?.test).toMatchObject({ module: FIRST_MODULE, state: "passed" });
	});

	it("get returns found=false for an unknown test", async () => {
		const result = await call("test", { action: "get", fullName: "nonexistent > test", project: SEED_PROJECT }, SEEDED);
		expect(result.structuredContent?.action).toBe("get");
		expect(result.structuredContent?.found).toBe(false);
	});

	it("for_file returns count=0 and an empty testFiles[] for an unknown file", async () => {
		const result = await call("test", { action: "for_file", filePath: "nonexistent.ts" });
		expect(result.structuredContent).toEqual({
			action: "for_file",
			filePath: "nonexistent.ts",
			count: 0,
			testFiles: [],
		});
		expect(text(result)).toContain("No test modules found covering `nonexistent.ts`.");
	});

	it("for_tag returns an empty grouped envelope when no test carries the tag", async () => {
		const result = await call("test", { action: "for_tag", tag: "unit" }, SEEDED);
		expect(result.structuredContent).toMatchObject({ action: "for_tag", tag: "unit", count: 0, groups: [] });
	});

	it("annotations returns an empty, counted payload for a test that recorded nothing", async () => {
		const result = await call(
			"test",
			{ action: "annotations", fullName: "utils > adds numbers", project: SEED_PROJECT },
			SEEDED,
		);
		expect(result.structuredContent).toEqual({
			action: "annotations",
			project: SEED_PROJECT,
			fullName: "utils > adds numbers",
			count: 0,
			annotations: [],
		});
	});

	it("annotations returns the recorded annotation descriptors", async () => {
		const result = await call(
			"test",
			{ action: "annotations", fullName: SEED_ERROR_FULL_NAME, project: SEED_ERROR_PROJECT },
			SEEDED,
		);
		expect(result.structuredContent?.count).toBe(1);
		const rows = result.structuredContent?.annotations as Array<{ type: string; message: string }>;
		expect(rows[0]).toMatchObject({ type: "issues", message: "flaky under load" });
	});

	it("artifacts returns an empty, counted payload for a test with none", async () => {
		const result = await call(
			"test",
			{ action: "artifacts", fullName: "utils > adds numbers", project: SEED_PROJECT, maxBytes: 0 },
			SEEDED,
		);
		expect(result.structuredContent).toMatchObject({ action: "artifacts", count: 0, artifacts: [] });
	});

	it("rejects a negative maxBytes, an unknown action, a missing required key and a foreign key", async () => {
		const negative = await call("test", { action: "artifacts", fullName: "x", maxBytes: -1 });
		expect(negative.isError).toBe(true);
		const unknownAction = await call("test", { action: "bogus" });
		expect(unknownAction.isError).toBe(true);
		const missing = await call("test", { action: "get" });
		expect(missing.isError).toBe(true);
		const foreign = await call("test", { action: "for_file", filePath: "a.ts", tag: "x" });
		expect(foreign.isError).toBe(true);
		expect(text(foreign)).toContain("Unrecognized parameter(s): tag");
	});
});

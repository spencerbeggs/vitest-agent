/**
 * Consolidated `inventory` MCP tool — Schema-driven implementation.
 *
 * Each `kind` produces a structured result that the boundary in
 * server.ts can render as markdown via the exported
 * `formatInventoryMarkdown` helper. The structured payload uses an
 * `inventoryKind` discriminant (named separately from the input
 * `kind` because `session` collapses to two output shapes — one for
 * single-id lookup and one for list).
 *
 * @packageDocumentation
 */

import { DataReader } from "@vitest-agent/sdk";
import { Effect, Match, Option, ParseResult, Schema } from "effect";
import { publicProcedure } from "../context.js";

const ProjectRunSummary = Schema.Struct({
	project: Schema.String,
	lastRun: Schema.NullOr(Schema.String),
	lastResult: Schema.NullOr(Schema.Literal("passed", "failed", "interrupted")),
	total: Schema.Number,
	passed: Schema.Number,
	failed: Schema.Number,
	skipped: Schema.Number,
}).annotations({ identifier: "InventoryProjectRow" });

const ModuleRow = Schema.Struct({
	id: Schema.Number,
	file: Schema.String,
	state: Schema.String,
	testCount: Schema.Number,
	duration: Schema.NullOr(Schema.Number),
}).annotations({ identifier: "InventoryModuleRow" });

const SuiteRow = Schema.Struct({
	id: Schema.Number,
	name: Schema.String,
	module: Schema.String,
	state: Schema.String,
	testCount: Schema.Number,
}).annotations({ identifier: "InventorySuiteRow" });

const SessionRow = Schema.Struct({
	id: Schema.Number,
	chatId: Schema.String,
	project: Schema.String,
	cwd: Schema.String,
	agentKind: Schema.Literal("main", "subagent"),
	agentType: Schema.NullOr(Schema.String),
	parentSessionId: Schema.NullOr(Schema.Number),
	triageWasNonEmpty: Schema.Boolean,
	startedAt: Schema.String,
	endedAt: Schema.NullOr(Schema.String),
	endReason: Schema.NullOr(Schema.String),
}).annotations({ identifier: "InventorySessionRow" });

const ProjectInventory = Schema.Struct({
	inventoryKind: Schema.Literal("project"),
	count: Schema.Number,
	projects: Schema.Array(ProjectRunSummary),
}).annotations({ identifier: "ProjectInventory" });

const ModuleGroup = Schema.Struct({ project: Schema.String, modules: Schema.Array(ModuleRow) });
const ModuleInventory = Schema.Struct({
	inventoryKind: Schema.Literal("module"),
	count: Schema.Number,
	groups: Schema.Array(ModuleGroup),
}).annotations({ identifier: "ModuleInventory" });

const SuiteGroup = Schema.Struct({ project: Schema.String, suites: Schema.Array(SuiteRow) });
const SuiteInventory = Schema.Struct({
	inventoryKind: Schema.Literal("suite"),
	count: Schema.Number,
	groups: Schema.Array(SuiteGroup),
}).annotations({ identifier: "SuiteInventory" });

const SessionDetailFound = Schema.Struct({
	inventoryKind: Schema.Literal("session_detail"),
	found: Schema.Literal(true),
	session: SessionRow,
}).annotations({ identifier: "SessionDetailFound" });

const SessionDetailMissing = Schema.Struct({
	inventoryKind: Schema.Literal("session_detail"),
	found: Schema.Literal(false),
	id: Schema.Number,
}).annotations({ identifier: "SessionDetailMissing" });

const SessionListInventory = Schema.Struct({
	inventoryKind: Schema.Literal("session_list"),
	count: Schema.Number,
	sessions: Schema.Array(SessionRow),
}).annotations({ identifier: "SessionListInventory" });

const TagProjectBreakdown = Schema.Struct({
	project: Schema.String,
	moduleCount: Schema.Number,
	testCount: Schema.Number,
}).annotations({ identifier: "TagProjectBreakdown" });

const TagRowScoped = Schema.Struct({
	tag: Schema.String,
	moduleCount: Schema.Number,
	testCount: Schema.Number,
}).annotations({ identifier: "TagRowScoped" });

const TagRowUnscoped = Schema.Struct({
	tag: Schema.String,
	moduleCount: Schema.Number,
	testCount: Schema.Number,
	byProject: Schema.Array(TagProjectBreakdown),
}).annotations({ identifier: "TagRowUnscoped" });

const TagInventoryScoped = Schema.Struct({
	inventoryKind: Schema.Literal("tag_scoped"),
	project: Schema.String,
	count: Schema.Number,
	tags: Schema.Array(TagRowScoped),
}).annotations({ identifier: "TagInventoryScoped" });

const TagInventoryUnscoped = Schema.Struct({
	inventoryKind: Schema.Literal("tag_unscoped"),
	count: Schema.Number,
	tags: Schema.Array(TagRowUnscoped),
}).annotations({ identifier: "TagInventoryUnscoped" });

export const InventoryResult = Schema.Union(
	ProjectInventory,
	ModuleInventory,
	SuiteInventory,
	SessionDetailFound,
	SessionDetailMissing,
	SessionListInventory,
	TagInventoryScoped,
	TagInventoryUnscoped,
).annotations({
	identifier: "InventoryResult",
	title: "inventory result",
	description:
		"Discriminate on `inventoryKind`. project/module/suite carry counted lists; session_detail discriminates further on `found`; session_list returns the matching sessions; tag_scoped and tag_unscoped carry per-tag counts (the unscoped form also carries a `byProject` breakdown per tag).",
});
export type InventoryResultType = Schema.Schema.Type<typeof InventoryResult>;

export const formatInventoryMarkdown = (data: InventoryResultType): string => {
	if (data.inventoryKind === "project") {
		if (data.count === 0) return "No projects found. Run tests first.";
		const lines: string[] = [
			"## Projects",
			"",
			"| Project | Last Run | Result | Total | Passed | Failed | Skipped |",
			"| --- | --- | --- | --- | --- | --- | --- |",
		];
		for (const p of data.projects) {
			const lastRun = p.lastRun ? p.lastRun.split("T")[0] : "—";
			const result = p.lastResult ?? "—";
			lines.push(`| ${p.project} | ${lastRun} | ${result} | ${p.total} | ${p.passed} | ${p.failed} | ${p.skipped} |`);
		}
		return lines.join("\n");
	}
	if (data.inventoryKind === "module") {
		if (data.count === 0) {
			return "No modules found. Run run_tests({}) to execute tests and populate the database.";
		}
		const lines: string[] = ["## Modules", ""];
		for (const g of data.groups) {
			lines.push(`### ${g.project}`, "", "| ID | File | State | Tests | Duration |", "| --- | --- | --- | --- | --- |");
			for (const m of g.modules) {
				const duration = m.duration !== null ? `${m.duration}ms` : "—";
				lines.push(`| ${m.id} | ${m.file} | ${m.state} | ${m.testCount} | ${duration} |`);
			}
			lines.push("");
		}
		return lines.join("\n").trimEnd();
	}
	if (data.inventoryKind === "suite") {
		if (data.count === 0) return "No suites found. Run run_tests({}) to execute tests and populate the database.";
		const lines: string[] = ["## Suites", ""];
		for (const g of data.groups) {
			lines.push(`### ${g.project}`, "", "| ID | Name | Module | State | Tests |", "| --- | --- | --- | --- | --- |");
			for (const s of g.suites) {
				lines.push(`| ${s.id} | ${s.name} | ${s.module} | ${s.state} | ${s.testCount} |`);
			}
			lines.push("");
		}
		return lines.join("\n").trimEnd();
	}
	if (data.inventoryKind === "session_detail") {
		if (!data.found) return `No session with id=${data.id}.`;
		const s = data.session;
		const lines: string[] = [
			`# Session ${s.id}`,
			"",
			`- chatId: \`${s.chatId}\``,
			`- project: ${s.project}`,
			`- agentKind: ${s.agentKind}${s.agentType !== null ? ` (${s.agentType})` : ""}`,
			`- started: ${s.startedAt}`,
			`- ended: ${s.endedAt ?? "still open"}`,
			`- triageWasNonEmpty: ${s.triageWasNonEmpty}`,
		];
		if (s.parentSessionId !== null) lines.push(`- parentSessionId: ${s.parentSessionId}`);
		return lines.join("\n");
	}
	if (data.inventoryKind === "tag_scoped") {
		if (data.count === 0) {
			return `No tags recorded for project \`${data.project}\`. Run run_tests({}) to populate.`;
		}
		const lines: string[] = [`## Tags — ${data.project}`, "", "| Tag | Modules | Tests |", "| --- | --- | --- |"];
		for (const t of data.tags) {
			lines.push(`| ${t.tag} | ${t.moduleCount} | ${t.testCount} |`);
		}
		return lines.join("\n");
	}
	if (data.inventoryKind === "tag_unscoped") {
		if (data.count === 0) {
			return "No tags recorded. Run run_tests({}) to populate.";
		}
		const lines: string[] = ["## Tags", "", "| Tag | Modules | Tests | Projects |", "| --- | --- | --- | --- |"];
		for (const t of data.tags) {
			const projectsBreakdown = t.byProject.map((p) => `${p.project} (${p.testCount})`).join(", ");
			lines.push(`| ${t.tag} | ${t.moduleCount} | ${t.testCount} | ${projectsBreakdown} |`);
		}
		return lines.join("\n");
	}
	// session_list
	if (data.count === 0) return "No sessions recorded yet.";
	const lines: string[] = ["# Sessions", ""];
	for (const s of data.sessions) {
		const ended = s.endedAt ? `ended ${s.endedAt}` : "open";
		lines.push(`- **${s.chatId}** [${s.agentKind}] project=${s.project} started=${s.startedAt} ${ended}`);
	}
	return lines.join("\n");
};

export const InventoryAsMarkdown = Schema.transformOrFail(InventoryResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatInventoryMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(new ParseResult.Forbidden(ast, text, "InventoryAsMarkdown is one-way.")),
});

const ProjectVariant = Schema.Struct({ kind: Schema.Literal("project") });
const ModuleVariant = Schema.Struct({
	kind: Schema.Literal("module"),
	project: Schema.optional(Schema.String),
});
const SuiteVariant = Schema.Struct({
	kind: Schema.Literal("suite"),
	project: Schema.optional(Schema.String),
	module: Schema.optional(Schema.String),
});
const SessionVariant = Schema.Struct({
	kind: Schema.Literal("session"),
	id: Schema.optional(Schema.Number),
	project: Schema.optional(Schema.String),
	agentKind: Schema.optional(Schema.Literal("main", "subagent")),
	limit: Schema.optional(Schema.Number),
});
const TagVariant = Schema.Struct({
	kind: Schema.Literal("tag"),
	project: Schema.optional(Schema.String),
});

const InventoryInput = Schema.Union(ProjectVariant, ModuleVariant, SuiteVariant, SessionVariant, TagVariant);

export const inventory = publicProcedure
	.input(Schema.standardSchemaV1(InventoryInput))
	.query(async ({ ctx, input }): Promise<InventoryResultType> => {
		return ctx.runtime.runPromise(
			Match.value(input).pipe(
				Match.discriminatorsExhaustive("kind")({
					project: () =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const projects = yield* reader.getRunsByProject();
							return {
								inventoryKind: "project" as const,
								count: projects.length,
								projects: projects.map((p) => ({
									project: p.project,
									lastRun: p.lastRun,
									lastResult: p.lastResult,
									total: p.total,
									passed: p.passed,
									failed: p.failed,
									skipped: p.skipped,
								})),
							};
						}),
					module: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const targets = variant.project
								? [{ project: variant.project }]
								: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => ({ project: r.project }))));
							const groups: Array<{ project: string; modules: ReadonlyArray<Schema.Schema.Type<typeof ModuleRow>> }> =
								[];
							let total = 0;
							for (const t of targets) {
								const modules = yield* reader.listModules(t.project);
								if (modules.length > 0) {
									groups.push({ project: t.project, modules });
									total += modules.length;
								}
							}
							return { inventoryKind: "module" as const, count: total, groups };
						}),
					suite: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const opts: { module?: string } = {};
							if (variant.module !== undefined) opts.module = variant.module;
							const targets = variant.project
								? [{ project: variant.project }]
								: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => ({ project: r.project }))));
							const groups: Array<{ project: string; suites: ReadonlyArray<Schema.Schema.Type<typeof SuiteRow>> }> = [];
							let total = 0;
							for (const t of targets) {
								const suites = yield* reader.listSuites(t.project, opts);
								if (suites.length > 0) {
									groups.push({ project: t.project, suites });
									total += suites.length;
								}
							}
							return { inventoryKind: "suite" as const, count: total, groups };
						}),
					session: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							if (variant.id !== undefined) {
								const opt = yield* reader.getSessionById(variant.id);
								return Option.isNone(opt)
									? { inventoryKind: "session_detail" as const, found: false as const, id: variant.id }
									: { inventoryKind: "session_detail" as const, found: true as const, session: opt.value };
							}
							const rows = yield* reader.listSessions({
								...(variant.project !== undefined && { project: variant.project }),
								...(variant.agentKind !== undefined && { agentKind: variant.agentKind }),
								...(variant.limit !== undefined && { limit: variant.limit }),
							});
							return { inventoryKind: "session_list" as const, count: rows.length, sessions: rows };
						}),
					tag: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							if (variant.project !== undefined) {
								const rows = yield* reader.listTagInventory({ project: variant.project });
								return {
									inventoryKind: "tag_scoped" as const,
									project: variant.project,
									count: rows.length,
									tags: rows.map((r) => ({
										tag: r.tag,
										moduleCount: r.moduleCount,
										testCount: r.testCount,
									})),
								};
							}
							// Unscoped: pivot the flat (tag, project) rows into one row per tag
							// with an inline byProject breakdown and aggregated counts.
							const rows = yield* reader.listTagInventory();
							const byTag = new Map<
								string,
								{
									moduleCount: number;
									testCount: number;
									byProject: Array<{ project: string; moduleCount: number; testCount: number }>;
								}
							>();
							for (const r of rows) {
								let entry = byTag.get(r.tag);
								if (entry === undefined) {
									entry = { moduleCount: 0, testCount: 0, byProject: [] };
									byTag.set(r.tag, entry);
								}
								entry.moduleCount += r.moduleCount;
								entry.testCount += r.testCount;
								entry.byProject.push({
									project: r.project,
									moduleCount: r.moduleCount,
									testCount: r.testCount,
								});
							}
							const tags = Array.from(byTag.entries())
								.sort(([a], [b]) => a.localeCompare(b))
								.map(([tag, e]) => ({
									tag,
									moduleCount: e.moduleCount,
									testCount: e.testCount,
									byProject: e.byProject,
								}));
							return {
								inventoryKind: "tag_unscoped" as const,
								count: tags.length,
								tags,
							};
						}),
				}),
			),
		);
	});

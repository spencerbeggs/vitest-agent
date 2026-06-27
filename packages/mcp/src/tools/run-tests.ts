import { AsyncLocalStorage } from "node:async_hooks";
import { Writable } from "node:stream";
import type { AgentReport, ConsoleLeakTask, VitestModuleError } from "@vitest-agent/sdk";
import {
	AgentReport as AgentReportSchema,
	DataReader,
	DataStore,
	buildAgentReport,
	buildConsoleLeaks,
	collectConsoleLeakEntries,
} from "@vitest-agent/sdk";
import { Effect, ParseResult, Schema } from "effect";
import { publicProcedure } from "../context.js";

const RunTestsOk = Schema.Struct({
	kind: Schema.Literal("ok").annotations({
		description: "Discriminant — `true` test run completed (with or without failures).",
	}),
	project: Schema.optional(Schema.String),
	report: AgentReportSchema.annotations({
		description: "Full AgentReport including pass/fail counts and per-module errors.",
	}),
	classifications: Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
		description: "Per-test classification labels: stable, new-failure, persistent, flaky, recovered.",
	}),
}).annotations({ identifier: "RunTestsOk" });

const RunTestsTimeout = Schema.Struct({
	kind: Schema.Literal("timeout"),
	timeoutSeconds: Schema.Number,
}).annotations({ identifier: "RunTestsTimeout" });

const RunTestsError = Schema.Struct({
	kind: Schema.Literal("error"),
	message: Schema.String,
}).annotations({ identifier: "RunTestsError" });

const TagFilter = Schema.Struct({
	all: Schema.optional(Schema.Array(Schema.String)),
	any: Schema.optional(Schema.Array(Schema.String)),
	none: Schema.optional(Schema.Array(Schema.String)),
}).annotations({
	identifier: "TagFilter",
	description:
		"All three sub-filters AND together with `project` and `files`. `all` requires every listed tag on the test. `any` requires at least one. `none` excludes any test carrying a listed tag.",
});
export type TagFilterType = Schema.Schema.Type<typeof TagFilter>;

const RunTestsNoMatch = Schema.Struct({
	kind: Schema.Literal("no-match").annotations({
		description:
			"Discriminant — the resolved filter set matched zero test cases. Tests did not run; this is independent of passWithNoTests policy.",
	}),
	filter: Schema.Struct({
		project: Schema.NullOr(Schema.String),
		files: Schema.Array(Schema.String),
		tags: Schema.NullOr(TagFilter),
		resolvedExpression: Schema.NullOr(Schema.String),
	}),
}).annotations({ identifier: "RunTestsNoMatch" });

export const RunTestsResult = Schema.Union(RunTestsOk, RunTestsTimeout, RunTestsError, RunTestsNoMatch).annotations({
	identifier: "RunTestsResult",
	title: "run_tests result",
	description:
		"Discriminate on `kind`. ok carries the full AgentReport plus per-test classifications; timeout / error are the two failure modes; no-match indicates that the resolved filter set matched zero test cases.",
});
export type RunTestsResultType = Schema.Schema.Type<typeof RunTestsResult>;

/**
 * Compose a Vitest tag-expression string from a structured {@link TagFilter}.
 *
 * Returns `null` when every sub-filter is empty/absent. Combines the three
 * sub-filters with ` and `:
 *
 * - `all: ["int", "slow"]`   → `"int and slow"`
 * - `any: ["unit", "int"]`   → `"(unit or int)"`
 * - `none: ["slow", "flaky"]`→ `"not slow and not flaky"`
 *
 * @internal
 */
export function composeTagExpression(tags: TagFilterType | null | undefined): string | null {
	if (!tags) return null;
	const parts: string[] = [];
	const all = tags.all ?? [];
	const any = tags.any ?? [];
	const none = tags.none ?? [];
	if (all.length > 0) {
		parts.push(all.join(" and "));
	}
	if (any.length > 0) {
		parts.push(any.length === 1 ? any[0] : `(${any.join(" or ")})`);
	}
	if (none.length > 0) {
		parts.push(none.map((t) => `not ${t}`).join(" and "));
	}
	if (parts.length === 0) return null;
	return parts.join(" and ");
}

const FORBIDDEN_CHARS = /[;|&`$(){}[\]<>!#]/;

// AsyncLocalStorage-scoped redirection. The prior implementation mutated
// `process.stdout.write` / `process.stderr.write` globally for the full
// duration of the test run. That broke under concurrent MCP requests:
// the JSON-RPC transport and unrelated tool handlers write to stdout/stderr
// from their own async chains, so a parallel response could be swallowed
// into the null sink and disappear from the wire. The mutex didn't help
// because it only serialized run_tests against other run_tests calls.
//
// Now: the wrapper is patched onto `process.stdout` / `process.stderr` once,
// then consults the per-context storage on every call. Inside a
// `withStdioCaptured` async context the write is diverted to the sink;
// outside of it (i.e. every other tRPC procedure handler running on its
// own top-level async chain) the write passes through to the original.
const stdoutSinkStorage = new AsyncLocalStorage<Writable>();
const stderrSinkStorage = new AsyncLocalStorage<Writable>();

let _stdioPatched = false;
let _originalStdoutWrite: typeof process.stdout.write;
let _originalStderrWrite: typeof process.stderr.write;

function ensureStdioPatched(): void {
	if (_stdioPatched) return;
	_stdioPatched = true;
	// Save unbound references — JavaScript's method-call binding restores
	// `this` automatically when the wrapper is invoked via
	// `process.stdout.write(...)`. Pre-binding here would leak a fresh
	// bound wrapper on every patch, so back-to-back wraps would observe
	// stacked `bind`-layers instead of the true original.
	_originalStdoutWrite = process.stdout.write;
	_originalStderrWrite = process.stderr.write;
	process.stdout.write = function patchedStdoutWrite(this: typeof process.stdout, ...args: unknown[]) {
		const sink = stdoutSinkStorage.getStore();
		if (sink) {
			return (sink.write as (...a: unknown[]) => boolean).apply(sink, args);
		}
		return (_originalStdoutWrite as (...a: unknown[]) => boolean).apply(this, args);
	} as typeof process.stdout.write;
	process.stderr.write = function patchedStderrWrite(this: typeof process.stderr, ...args: unknown[]) {
		const sink = stderrSinkStorage.getStore();
		if (sink) {
			return (sink.write as (...a: unknown[]) => boolean).apply(sink, args);
		}
		return (_originalStderrWrite as (...a: unknown[]) => boolean).apply(this, args);
	} as typeof process.stderr.write;
}

/**
 * Run `fn` with `process.stdout.write` and `process.stderr.write`
 * diverted to `stream.write` for code executing inside the call's
 * async context. Code in other async contexts (concurrent tRPC
 * procedure handlers, the MCP stdio transport) sees the original
 * writes unchanged.
 *
 * Vitest's own stdout/stderr redirect options only cover Vitest-internal
 * logging. User-registered reporters that call `console.log` directly
 * bypass them; this helper captures those writes into the supplied
 * sink so they don't corrupt the JSON-RPC protocol stream.
 *
 * @internal
 */
export async function withStdioCaptured<T>(stream: Writable, fn: () => Promise<T>): Promise<T> {
	ensureStdioPatched();
	return stdoutSinkStorage.run(stream, () => stderrSinkStorage.run(stream, fn));
}

export function sanitizeTestArgs(args: readonly string[]): string[] {
	const result: string[] = [];
	for (const arg of args) {
		if (FORBIDDEN_CHARS.test(arg)) {
			throw new Error(`Unsafe argument rejected: ${arg}`);
		}
		result.push(arg);
	}
	return result;
}

// Serializes concurrent run_tests invocations. The body assigns the
// active attribution UUIDs into `process.env.VITEST_AGENT_*` and then
// awaits `createVitest`/`vitest.start`, which spawns the worker pool
// that snapshots env at spawn time. Two interleaved tRPC calls would
// race: caller B's env assignment can land between A's assignment and
// A's worker spawn, attributing A's results to B's agent. The mutex
// keeps the env-write + worker-spawn pair atomic from the perspective
// of any other run_tests call in this process.
let _runTestsChain: Promise<unknown> = Promise.resolve();
function serializeRunTests<T>(fn: () => Promise<T>): Promise<T> {
	const next = _runTestsChain.then(fn, fn);
	_runTestsChain = next.catch(() => undefined);
	return next;
}

/**
 * Coerce unknown Vitest unhandled errors into VitestModuleError shape.
 *
 * @internal
 */
export function coerceErrors(errors: readonly unknown[]): VitestModuleError[] {
	return errors.map((e) => {
		if (e && typeof e === "object" && "message" in e) {
			const err = e as { message: string; stacks?: string[]; stack?: string };
			return {
				message: String(err.message),
				...(err.stacks ? { stacks: err.stacks } : err.stack ? { stacks: [err.stack] } : {}),
			};
		}
		return { message: String(e) };
	});
}

/**
 * Serialize an AgentReport plus classifications as pretty-printed JSON.
 *
 * @internal
 */
export function formatReportJson(report: AgentReport, classifications?: ReadonlyMap<string, string>): string {
	return JSON.stringify(
		{
			report,
			classifications: classifications ? Object.fromEntries(classifications) : undefined,
		},
		null,
		2,
	);
}

/**
 * Render the full structured `RunTestsResult` as markdown for the
 * text channel. Discriminates on `kind` then defers to the existing
 * AgentReport rendering for the `ok` case.
 */
export function formatRunTestsMarkdown(data: RunTestsResultType): string {
	if (data.kind === "timeout") return `Test run timed out after ${data.timeoutSeconds} seconds.`;
	if (data.kind === "error") return `Test run failed: ${data.message}`;
	if (data.kind === "no-match") return formatNoMatchMarkdown(data.filter);
	const classMap = new Map<string, string>(Object.entries(data.classifications));
	return formatReportMarkdown(data.report, classMap);
}

/**
 * Render the `no-match` filter context plus a remediation pointer aimed at
 * tag introspection. Pure helper; called by {@link formatRunTestsMarkdown}.
 *
 * @internal
 */
export function formatNoMatchMarkdown(filter: {
	readonly project: string | null;
	readonly files: ReadonlyArray<string>;
	readonly tags: TagFilterType | null;
	readonly resolvedExpression: string | null;
}): string {
	const lines: string[] = ["## No tests matched the filter", ""];
	const parts: string[] = [];
	if (filter.project !== null) parts.push(`project: \`${filter.project}\``);
	if (filter.files.length > 0) parts.push(`files: ${filter.files.map((f) => `\`${f}\``).join(", ")}`);
	if (filter.tags !== null) {
		const t = filter.tags;
		if (t.all && t.all.length > 0) parts.push(`tags.all: ${t.all.map((s) => `\`${s}\``).join(", ")}`);
		if (t.any && t.any.length > 0) parts.push(`tags.any: ${t.any.map((s) => `\`${s}\``).join(", ")}`);
		if (t.none && t.none.length > 0) parts.push(`tags.none: ${t.none.map((s) => `\`${s}\``).join(", ")}`);
	}
	if (filter.resolvedExpression !== null) {
		parts.push(`resolved expression: \`${filter.resolvedExpression}\``);
	}
	if (parts.length === 0) {
		lines.push("- (no filter recorded)");
	} else {
		for (const p of parts) lines.push(`- ${p}`);
	}
	lines.push("");
	lines.push("### Next steps");
	if (filter.tags !== null) {
		lines.push('- Confirm the tag exists: `inventory({ kind: "tag" })`');
		lines.push('- List tests for a specific tag: `test({ action: "for_tag", tag: "<name>" })`');
	}
	if (filter.files.length > 0) {
		lines.push('- Verify file paths exist or list tests in a file with `test({ action: "for_file", filePath })`');
	}
	if (filter.project !== null) {
		lines.push('- Verify the project name with `inventory({ kind: "project" })`');
	}
	return lines.join("\n");
}

export const RunTestsAsMarkdown = Schema.transformOrFail(RunTestsResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatRunTestsMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(new ParseResult.Forbidden(ast, text, "RunTestsAsMarkdown is one-way.")),
});

/**
 * Format an AgentReport as concise markdown suitable for MCP tool output.
 *
 * Classifications map test fullName to labels like "new-failure",
 * "persistent", "flaky", "recovered", "stable". Populated from DB
 * after the reporter writes history.
 *
 * @internal
 */
export function formatReportMarkdown(report: AgentReport, classifications?: ReadonlyMap<string, string>): string {
	const lines: string[] = [];
	const { summary } = report;

	// Modules that failed to collect (import error, syntax error, beforeAll
	// throw): the module is in `report.failed` with no failing test cases
	// but a non-empty `errors` array. These never bump `summary.failed`,
	// so we count them separately to drive both the headline status and
	// the "N failed to load" tally.
	const collectionFailedFiles = report.failed
		.filter((m) => m.errors !== undefined && m.errors.length > 0 && !m.tests.some((t) => t.state === "failed"))
		.map((m) => m.file);

	const hasCollectionFailures = collectionFailedFiles.length > 0;
	const isFailing = summary.failed > 0 || report.unhandledErrors.length > 0 || hasCollectionFailures;
	const status = isFailing ? "\u274C" : "\u2705";

	const headlineParts: string[] = [];
	if (summary.failed > 0) headlineParts.push(`${summary.failed} failed`);
	if (hasCollectionFailures) {
		headlineParts.push(`${collectionFailedFiles.length} failed to load`);
	}
	headlineParts.push(`${summary.passed} passed`);
	if (summary.skipped > 0) headlineParts.push(`${summary.skipped} skipped`);

	lines.push(`## ${status} Vitest -- ${headlineParts.join(", ")} (${summary.duration}ms)`);

	if (report.project) {
		lines.push(`\nProject: ${report.project}`);
	}

	if (report.consoleLeaks !== undefined) {
		const cl = report.consoleLeaks;
		const writes = `${cl.total} stray console write${cl.total === 1 ? "" : "s"}`;
		// byFile is capped (see buildConsoleLeaks); when truncated the file count
		// is a floor, so render "N+ files" rather than understating it.
		const plural = cl.byFile.length !== 1 || cl.truncated === true;
		const files = `${cl.byFile.length}${cl.truncated === true ? "+" : ""} file${plural ? "s" : ""}`;
		lines.push(`\n⚠ ${writes} across ${files} (see consoleLeaks)`);
	}

	for (const mod of report.failed) {
		lines.push(`\n### \u274C \`${mod.file}\``);
		// Module-level errors (collection / load / hook failures) carry no
		// associated test case, so render them as their own block before
		// the per-test details so the failure reason isn't buried.
		if (mod.errors) {
			for (const err of mod.errors) {
				lines.push(`\n- \u274C **Module failed to load**: ${err.message}`);
				if (err.stack) {
					lines.push(`\n  \`\`\`\n  ${err.stack}\n  \`\`\``);
				}
			}
		}
		for (const test of mod.tests) {
			if (test.state !== "failed") continue;
			const badge = classifications?.get(test.fullName);
			const label = badge ? ` [${badge}]` : "";
			lines.push(`\n- \u274C **${test.fullName}**${label}`);
			if (test.errors) {
				for (const err of test.errors) {
					lines.push(`  ${err.message}`);
					if (err.diff) {
						const diff =
							err.diff.length > 1000
								? `${err.diff.slice(0, 1000)}\n... (truncated, ${err.diff.length} chars total)`
								: err.diff;
						lines.push(`\n  \`\`\`diff\n  ${diff}\n  \`\`\``);
					}
				}
			}
		}
	}

	if (report.unhandledErrors.length > 0) {
		lines.push("\n### Unhandled Errors");
		for (const err of report.unhandledErrors) {
			lines.push(`\n- ${err.message}`);
			if (err.stack) {
				lines.push(`  \`\`\`\n  ${err.stack}\n  \`\`\``);
			}
		}
	}

	// Next steps
	if (isFailing) {
		const newFailures = classifications ? [...classifications.values()].filter((c) => c === "new-failure").length : 0;
		const persistent = classifications ? [...classifications.values()].filter((c) => c === "persistent").length : 0;
		const flaky = classifications ? [...classifications.values()].filter((c) => c === "flaky").length : 0;

		lines.push("\n### Next steps\n");
		if (newFailures > 0) lines.push(`- ${newFailures} new failure${newFailures > 1 ? "s" : ""} since last run`);
		if (persistent > 0) lines.push(`- ${persistent} persistent failure${persistent > 1 ? "s" : ""} (pre-existing)`);
		if (flaky > 0) lines.push(`- ${flaky} flaky test${flaky > 1 ? "s" : ""} -- consider retrying`);
		lines.push("- Use test_errors for detailed error analysis");
		lines.push("- Use test_history to check failure patterns");
		if (report.failedFiles.length > 0) {
			lines.push(`- Re-run failed: run_tests({ files: ${JSON.stringify(report.failedFiles)} })`);
		}
	}

	return lines.join("\n");
}

export const runTests = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				files: Schema.optional(Schema.Array(Schema.String)),
				project: Schema.optional(Schema.String),
				tags: Schema.optional(TagFilter),
				passWithNoTests: Schema.optional(Schema.Boolean),
				timeout: Schema.optional(Schema.Number),
				// Injected by the `pre-tool-use-mcp-run-tests.sh` hook —
				// agents do not pass this directly. Carries the recovered
				// VITEST_AGENT_* attribution UUIDs because Claude Code does
				// not auto-source CLAUDE_ENV_FILE into MCP children.
				_sessionContext: Schema.optional(
					Schema.Struct({
						chatId: Schema.String,
						conversationId: Schema.String,
						mainAgentId: Schema.String,
					}),
				),
			}),
		),
	)
	.mutation(
		({ ctx, input }): Promise<RunTestsResultType> =>
			serializeRunTests(async (): Promise<RunTestsResultType> => {
				const files = input.files ? sanitizeTestArgs(input.files) : [];
				const project = input.project ? sanitizeTestArgs([input.project])[0] : undefined;
				// Sanitize tag values too — they ride into Vitest's tag-expression
				// compiler unmodified, so shell-metachar injections must be
				// rejected the same way file/project arguments are.
				const tagsInput = input.tags;
				if (tagsInput) {
					if (tagsInput.all) sanitizeTestArgs(tagsInput.all);
					if (tagsInput.any) sanitizeTestArgs(tagsInput.any);
					if (tagsInput.none) sanitizeTestArgs(tagsInput.none);
				}
				const resolvedExpression = composeTagExpression(tagsInput ?? null);
				const hasFilter = files.length > 0 || project !== undefined || resolvedExpression !== null;

				const timeoutMs = (input.timeout ?? 120) * 1000;

				// Propagate the active SessionContext into process.env so the
				// in-process Vitest reporter (which reads VITEST_AGENT_*
				// directly from the environment at startup) attributes this run
				// to the active agent. The surrounding `serializeRunTests`
				// mutex keeps this write atomic with the worker-pool spawn —
				// concurrent calls cannot interleave their env assignments
				// between another call's write and its `createVitest` start.
				//
				// Source priority (most authoritative first):
				//   1. `input._sessionContext` — injected by the
				//      `pre-tool-use-mcp-run-tests.sh` hook on every call;
				//      always reflects the SessionStart-written exports.
				//   2. `ctx.sessionContext.get()` — boot-time fallback (will be
				//      `null` in practice because Claude Code does not
				//      auto-source CLAUDE_ENV_FILE into MCP children).
				const fromInput = input._sessionContext ?? null;
				const recovered = fromInput ?? ctx.sessionContext.get();
				if (recovered !== null) {
					process.env.VITEST_AGENT_CHAT_ID = recovered.chatId;
					process.env.VITEST_AGENT_CONVERSATION_ID = recovered.conversationId;
					process.env.VITEST_AGENT_AGENT_ID = recovered.mainAgentId;
				}

				// The MCP server communicates over stdio, so Vitest's console
				// output must not leak into stdout. Redirect to a null writable.
				const nullStream = new Writable({
					write(_chunk, _encoding, cb) {
						cb();
					},
				});

				// Dynamic import: vitest/node is only needed when this tool is
				// invoked. Keeps the MCP server startup fast.
				const { createVitest } = await import("vitest/node");

				let vitest: Awaited<ReturnType<typeof createVitest>> | undefined;

				try {
					vitest = await createVitest(
						"test",
						{
							root: ctx.cwd,
							run: true,
							// Inherit coverage from the user's vitest.config. Forcing
							// `enabled: false` here was overriding intentional
							// "coverage on by default" configurations and forced the
							// orchestrator to make a parallel Bash --coverage call
							// just to populate file_coverage rows.
							...(project ? { project } : {}),
							// Vitest's `tagsFilter: string[]` accepts one or more
							// tag-expression strings (AND-ed together). We compose
							// a single expression from the structured TagFilter
							// and pass it as a one-element array.
							...(resolvedExpression !== null ? { tagsFilter: [resolvedExpression] } : {}),
							// Per-call override of Vitest's native test.passWithNoTests.
							// When unset on the input we forward nothing, and Vitest
							// re-resolves the policy from the project config on disk.
							// The plugin's ResolvedReporterConfig snapshot of the
							// captured value is informational for consumer reporters
							// and is not read here.
							...(input.passWithNoTests !== undefined ? { passWithNoTests: input.passWithNoTests } : {}),
						},
						{}, // viteOverrides
						{
							stdout: nullStream as unknown as NodeJS.WriteStream,
							stderr: nullStream as unknown as NodeJS.WriteStream,
						},
					);
					const localVitest = vitest;

					let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
					const result = await withStdioCaptured(nullStream, () =>
						Promise.race([
							localVitest.start(files.length > 0 ? files : undefined),
							new Promise<never>((_, reject) => {
								timeoutHandle = setTimeout(() => reject(new Error("VITEST_TIMEOUT")), timeoutMs);
							}),
						]).finally(() => {
							if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
						}),
					);

					const testModules = result.testModules as unknown as Parameters<typeof buildAgentReport>[0];
					const unhandledErrors = coerceErrors(result.unhandledErrors);

					// Detect "no test cases matched the resolved filter set".
					// Tests-did-not-run vs tests-ran-and-passed is filter-driven, not
					// result-driven: an empty workspace with no filter is `ok` with
					// an empty report. The `passWithNoTests` policy controls
					// pass/fail classification only — it never reshapes the
					// discriminator.
					if (hasFilter && result.testModules.length === 0 && unhandledErrors.length === 0) {
						return {
							kind: "no-match" as const,
							filter: {
								project: project ?? null,
								files,
								tags: tagsInput ?? null,
								resolvedExpression,
							},
						};
					}

					const reason =
						unhandledErrors.length > 0 || result.testModules.some((m) => m.state() === "failed") ? "failed" : "passed";

					const baseReport = buildAgentReport(testModules, unhandledErrors, reason, { omitPassingTests: true });
					const leaks = buildConsoleLeaks(
						collectConsoleLeakEntries(localVitest.state.getFiles() as unknown as ConsoleLeakTask[]),
					);
					const report = leaks !== undefined ? { ...baseReport, consoleLeaks: leaks } : baseReport;

					// Read stored classifications from DB (written by the reporter via
					// classifyTest() during vitest.start). This avoids reimplementing
					// classification logic and stays consistent with AgentReporter.
					let classifications: ReadonlyMap<string, string> | undefined;
					try {
						classifications = await ctx.runtime.runPromise(
							Effect.gen(function* () {
								const reader = yield* DataReader;
								const projects: ReadonlyArray<string> = project
									? [project]
									: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => r.project)));
								const entries: Array<[string, string]> = [];
								for (const p of projects) {
									const tests = yield* reader.listTests(p, {});
									for (const t of tests) {
										if (t.classification != null) entries.push([t.fullName, t.classification]);
									}
								}
								return new Map(entries);
							}),
						);
					} catch {
						// Classification is best-effort; don't fail the tool if DB read fails
					}

					// Best-effort: associate the run with the current session so
					// session-scoped queries reflect this run. Never blocks the result.
					const chatId = ctx.currentSessionId.get();
					if (chatId !== null) {
						ctx.runtime
							.runPromise(
								Effect.gen(function* () {
									const store = yield* DataStore;
									yield* store.associateLatestRunWithSession({ chatId, invocationMethod: "mcp" });
								}),
							)
							.catch(() => undefined);
					}

					return {
						kind: "ok" as const,
						...(project !== undefined && { project }),
						report,
						classifications: classifications ? Object.fromEntries(classifications) : {},
					};
				} catch (err) {
					if (err instanceof Error && err.message === "VITEST_TIMEOUT") {
						return { kind: "timeout" as const, timeoutSeconds: input.timeout ?? 120 };
					}
					const message = err instanceof Error ? err.message : String(err);
					return { kind: "error" as const, message };
				} finally {
					await vitest?.close();
					nullStream.destroy();
				}
			}),
	);

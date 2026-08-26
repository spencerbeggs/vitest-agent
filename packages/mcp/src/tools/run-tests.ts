import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { AgentReport, ConsoleLeakTask, VitestModuleError } from "@vitest-agent/sdk";
import {
	AgentReport as AgentReportSchema,
	DataReader,
	DataStore,
	buildAgentReport,
	buildConsoleLeaks,
	coerceErrorField,
	collectConsoleLeakEntries,
} from "@vitest-agent/sdk";
import { Effect, Schema, SchemaGetter } from "effect";
import { publicProcedure } from "../context.js";

const TagFilter = Schema.Struct({
	all: Schema.optional(Schema.Array(Schema.String)),
	any: Schema.optional(Schema.Array(Schema.String)),
	none: Schema.optional(Schema.Array(Schema.String)),
}).annotate({
	identifier: "TagFilter",
	description:
		"All three sub-filters AND together with `project` and `files`. `all` requires every listed tag on the test. `any` requires at least one. `none` excludes any test carrying a listed tag.",
});
export type TagFilterType = Schema.Schema.Type<typeof TagFilter>;

const RunTestsScope = Schema.Struct({
	project: Schema.NullOr(Schema.String),
	files: Schema.Array(Schema.String),
	tags: Schema.NullOr(TagFilter),
}).annotate({
	identifier: "RunTestsScope",
	description:
		"The filter set actually used for this run, verbatim. Lets an agent tell 'ran exactly what I asked' apart from 'a dropped/misspelled param silently ran everything' without cross-checking summary counts.",
});

const RunTestsOk = Schema.Struct({
	kind: Schema.Literal("ok").annotate({
		description: "Discriminant — `true` test run completed (with or without failures).",
	}),
	project: Schema.optional(Schema.String),
	projectRoot: Schema.String.annotate({
		description:
			"The absolute Vitest root actually used for this run (issue #252). Echoed whether or not the caller supplied " +
			"a `projectRoot` param -- when absent, this is the server's boot-time ctx.cwd; when supplied and validated, " +
			"this is the resolved, validated path. Lets an agent confirm discovery resolved where it expected, or that " +
			"an explicit projectRoot was actually honored.",
	}),
	scope: RunTestsScope,
	report: AgentReportSchema.annotate({
		description: "Full AgentReport including pass/fail counts and per-module errors.",
	}),
	classifications: Schema.Record(Schema.String, Schema.String).annotate({
		description: "Per-test classification labels: stable, new-failure, persistent, flaky, recovered.",
	}),
	discoveryLastScannedAt: Schema.optional(Schema.NullOr(Schema.String)).annotate({
		description:
			"ISO timestamp of the most recent real disk scan performed by discoverProjects() in this process (issue #100). " +
			"`null`/absent means discovery has not scanned disk in this process yet (e.g. a config that doesn't call " +
			"AgentPlugin.discover()). A stale-looking test count is self-explaining when compared against this value.",
	}),
}).annotate({ identifier: "RunTestsOk" });

const RunTestsTimeout = Schema.Struct({
	kind: Schema.Literal("timeout"),
	timeoutSeconds: Schema.Number,
}).annotate({ identifier: "RunTestsTimeout" });

const RunTestsError = Schema.Struct({
	kind: Schema.Literal("error"),
	message: Schema.String,
}).annotate({ identifier: "RunTestsError" });

const RunTestsNoMatch = Schema.Struct({
	kind: Schema.Literal("no-match").annotate({
		description:
			"Discriminant — the resolved filter set matched zero test cases. Tests did not run; this is independent of passWithNoTests policy.",
	}),
	projectRoot: Schema.String.annotate({
		description:
			"The absolute Vitest root actually resolved for this call (issue #252) — echoed the same as on RunTestsOk, " +
			"even though no test ran.",
	}),
	filter: Schema.Struct({
		project: Schema.NullOr(Schema.String),
		files: Schema.Array(Schema.String),
		tags: Schema.NullOr(TagFilter),
		resolvedExpression: Schema.NullOr(Schema.String),
	}),
}).annotate({ identifier: "RunTestsNoMatch" });

export const RunTestsResult = Schema.Union([RunTestsOk, RunTestsTimeout, RunTestsError, RunTestsNoMatch]).annotate({
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

// Cross-package "last scan" handshake (issue #100). `@vitest-agent/mcp` cannot
// import `@vitest-agent/plugin`'s `discover-projects.ts` directly — the
// plugin package depends on `@vitest-agent/cli`/`@vitest-agent/mcp`, so the
// reverse import would be circular. Both sides instead read/write the same
// process-global slot via `Symbol.for()`, which resolves to the identical
// symbol across module instances in one process (mirrors the `ensureMigrated`
// globalThis-keyed promise cache, Decision 28). `createVitest` below loads
// `vitest.config.ts` in-process, which calls `discoverProjects()`, so both
// sides observe the same global by the time this tool's result is built.
const DISCOVERY_LAST_SCAN_SYMBOL = Symbol.for("vitest-agent:discovery:last-scan-at");

/**
 * Reads the ISO timestamp of the most recent real disk scan performed by
 * `discoverProjects()` in this process. `undefined` when discovery hasn't
 * scanned disk in this process yet.
 *
 * @internal
 */
export function readDiscoveryLastScannedAt(): string | undefined {
	const value = (globalThis as Record<symbol, unknown>)[DISCOVERY_LAST_SCAN_SYMBOL];
	return typeof value === "string" ? value : undefined;
}

/**
 * Per-invocation coverage temp directory. Vitest's v8 provider `rm -rf`s the
 * shared `coverage/` reports directory at run start (`clean: true` default),
 * so two concurrent runs in one checkout destroy each other's `.tmp` files
 * (ENOENT coverage-N.json — issues #159/#191/#194). Each MCP run gets its own
 * directory; coverage persistence is unaffected because the analyzer consumes
 * the in-memory CoverageMap, never the disk artifacts. Consequence: final
 * coverage artifacts (html/lcov) from MCP-driven runs land in the throwaway
 * dir instead of `./coverage` — acceptable because MCP consumers read
 * coverage from SQLite (`CoverageAnalyzer` consumes the in-memory map via
 * `onCoverage`), not from disk artifacts.
 *
 * @internal exported for tests
 */
export const makeCoverageDirOverride = (): { dir: string; coverage: { reportsDirectory: string } } => {
	const dir = mkdtempSync(join(tmpdir(), "vitest-agent-cov-"));
	return { dir, coverage: { reportsDirectory: dir } };
};

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

const execFileAsync = promisify(execFile);

/**
 * Resolve the git common directory for `dir` (`git rev-parse
 * --git-common-dir`) — identical across a repository and every worktree
 * attached to it, which is what makes it the right "same repository"
 * comparison (a plain `--show-toplevel` differs per worktree). Returns
 * `null` when `dir` is not inside a git repository or the command fails
 * for any other reason; callers treat `null` as "cannot confirm same
 * repository", never as a silent pass.
 *
 * @internal exported for tests
 */
export async function resolveGitCommonDir(dir: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], { cwd: dir });
		const trimmed = stdout.trim();
		if (trimmed.length === 0) return null;
		// `--git-common-dir` may print a path relative to `dir` (e.g. `.git`
		// for a plain repo) or an absolute, symlink-resolved path (e.g. from
		// inside a linked worktree, where git prints the realpath). Run both
		// shapes through `realpath` so a repo whose tmpdir sits behind a
		// symlink (macOS `/var/folders` -> `/private/var/folders`) compares
		// equal regardless of which form git chose to print.
		const candidate = resolve(dir, trimmed);
		return await realpath(candidate);
	} catch {
		return null;
	}
}

export type ProjectRootValidation = { ok: true; root: string } | { ok: false; message: string };

// Issue #259: Vitest finds the CONFIG FILE by walking UP from `root`, but
// resolves that config's relative `globalSetup` / `setupFiles` entries
// DOWNWARD from `resolved.root` (vitest@4.1.11:
// `resolved.globalSetup = toArray(...).map((file) => resolvePath(file, resolved.root))`).
// When the MCP server's boot dir (`ctx.cwd`, passed straight through as
// Vitest's `root`) is a package subtree of a monorepo, Vitest still walks
// up and loads `<repo>/vitest.config.ts`, but resolves that config's
// relative `globalSetup: ["vitest.setup.ts"]` against the subtree —
// producing `<repo>/packages/<pkg>/vitest.setup.ts`, which does not exist,
// and the run collects zero tests.
//
// `resolveConfigAnchoredRoot` closes that gap by walking UP from `startDir`
// looking for the SAME config Vitest would load, and returning the
// directory that holds it — so `root` and the config's directory can never
// disagree again. Candidate filenames are checked per-directory in the
// order Vitest itself prefers: `vitest.config.*` before `vite.config.*`
// (Vitest falls back to a Vite config only when no Vitest config exists),
// across ts/mts/cts/js/mjs/cjs. The walk is bounded at the git root (a
// worktree's `.git` is a FILE, not a directory — `existsSync` accepts
// either) so an unrelated `vite.config.ts` sitting above the repo can't
// silently capture the root. Never throws and never walks past a config
// miss into an ambiguous default — an unreadable/exotic path degrades to
// today's behavior: return `startDir` unchanged.
const VITEST_CONFIG_EXTENSIONS = ["ts", "mts", "cts", "js", "mjs", "cjs"] as const;

function dirHasVitestOrViteConfig(dir: string): boolean {
	for (const prefix of ["vitest.config.", "vite.config."]) {
		for (const ext of VITEST_CONFIG_EXTENSIONS) {
			if (existsSync(join(dir, `${prefix}${ext}`))) return true;
		}
	}
	return false;
}

/**
 * Walk UP from `startDir` looking for the vitest/vite config Vitest would
 * load anyway, returning the directory that holds it. Bounded at the git
 * root (inclusive — the directory containing `.git` is still examined
 * before the walk stops). Returns `startDir` unchanged when no config is
 * found in range, or when anything about the walk throws. See the
 * issue #259 comment above `validateProjectRoot` for the full rationale.
 *
 * @internal exported for tests
 */
export function resolveConfigAnchoredRoot(startDir: string): string {
	try {
		let dir = resolve(startDir);
		for (;;) {
			if (dirHasVitestOrViteConfig(dir)) return dir;
			if (existsSync(join(dir, ".git"))) return startDir;
			const parent = dirname(dir);
			if (parent === dir) return startDir;
			dir = parent;
		}
	} catch {
		return startDir;
	}
}

/**
 * Validate an optional caller-supplied `projectRoot` against `ctxCwd`
 * (the MCP server's boot-time root). `undefined` anchors at the directory
 * of the vitest/vite config Vitest would load anyway (issue #259, via
 * `resolveConfigAnchoredRoot`) — never inferred beyond that, never
 * defaulted to anything else when no config is found in range.
 *
 * A supplied `projectRoot` is VALIDATED, not trusted, and used VERBATIM
 * once validated — explicit is explicit, no anchoring applied. It must
 * resolve to an existing directory that shares a git common directory with
 * `ctxCwd` (same repository, including across worktrees). Any failure
 * returns `{ ok: false, message }` naming both paths — never a silent
 * fallback to `ctxCwd`, never a raw throw.
 *
 * @internal exported for tests
 */
export async function validateProjectRoot(
	projectRoot: string | undefined,
	ctxCwd: string,
): Promise<ProjectRootValidation> {
	if (projectRoot === undefined) {
		return { ok: true, root: resolveConfigAnchoredRoot(ctxCwd) };
	}
	// Resolve a relative `projectRoot` against `ctxCwd`, not the MCP
	// server's `process.cwd()`. Single-argument `resolve` would use the
	// server process's cwd — a base the caller cannot see and did not
	// choose. Absolute paths (the intended input) are unaffected.
	const resolvedRoot = resolve(ctxCwd, projectRoot);
	let isDirectory: boolean;
	try {
		const stats = await stat(resolvedRoot);
		isDirectory = stats.isDirectory();
	} catch {
		return {
			ok: false,
			message: `projectRoot "${resolvedRoot}" does not exist (ctx.cwd is "${ctxCwd}").`,
		};
	}
	if (!isDirectory) {
		return {
			ok: false,
			message: `projectRoot "${resolvedRoot}" is not a directory (ctx.cwd is "${ctxCwd}").`,
		};
	}
	const [rootCommonDir, cwdCommonDir] = await Promise.all([
		resolveGitCommonDir(resolvedRoot),
		resolveGitCommonDir(ctxCwd),
	]);
	if (rootCommonDir === null || cwdCommonDir === null || rootCommonDir !== cwdCommonDir) {
		return {
			ok: false,
			message: `projectRoot "${resolvedRoot}" does not belong to the same git repository as ctx.cwd "${ctxCwd}".`,
		};
	}
	return { ok: true, root: resolvedRoot };
}

/**
 * Issue #303: resolve `vitest/node` anchored at the run's project root
 * instead of the bare `"vitest/node"` specifier, which resolves relative to
 * `@vitest-agent/mcp`'s OWN install location. `vitest` is a peerDependency
 * of this package, and pnpm routinely materializes MORE THAN ONE physical
 * instance of the same vitest version when peer-resolution hashes differ
 * (e.g. `vitest@4.1.11_@types+node@26.2.0_...` alongside
 * `vitest@4.1.11_@types+node@26.3.0_...` under `node_modules/.pnpm`). When
 * the bare specifier resolves to a DIFFERENT physical copy than the one the
 * project's test files import, `SnapshotClient.setup()` runs against one
 * copy's module-level `_client` singleton while `expect(...).toMatchSnapshot()`
 * inside the test file goes through the other copy's singleton, which has
 * no state — every snapshot assertion then fails with "The snapshot state
 * for '<file>' is not found. Did you call 'SnapshotClient.setup()'?" while
 * every non-snapshot assertion still passes.
 *
 * `createRequire` needs a file path (not a bare directory) to anchor
 * resolution, hence the synthetic, never-created `__vitest-agent-resolver__.js`
 * filename joined onto `root`. vitest's package.json `exports` map for
 * `./node` carries a `default` condition (`./dist/node.js`) and vitest ships
 * `"type": "module"`, so `require.resolve("vitest/node")` resolves correctly
 * even though vitest itself is ESM — the result is then converted to a
 * `file://` URL, which is what dynamic `import()` needs.
 *
 * Falls back to the bare `"vitest/node"` specifier when root-anchored
 * resolution throws (e.g. a project root with no local vitest install) so
 * that case keeps working exactly as it did before this fix.
 *
 * @internal exported for tests
 */
export function resolveVitestNodeEntry(root: string): string {
	try {
		const req = createRequire(join(root, "__vitest-agent-resolver__.js"));
		return pathToFileURL(req.resolve("vitest/node")).href;
	} catch {
		return "vitest/node";
	}
}

/**
 * Indirection seam around `import(<vitest/node entry>)`. vitest's own
 * vite-node externalizes "vitest"/"vitest/node" for every importer, and
 * `vi.mock("vitest/node", ...)` only special-cases AST-literal
 * `import("vitest/node")` call sites for interception — a computed
 * specifier (unavoidable here; see `resolveVitestNodeEntry`) silently
 * bypasses that interception and loads the real module. Tests substitute
 * `.load` directly (mutating this shared object's property — no `vi.mock`
 * required) instead of trying to mock the module.
 *
 * @internal exported for tests
 */
export const vitestLoader = {
	load: (entry: string): Promise<{ createVitest: typeof import("vitest/node")["createVitest"] }> => import(entry),
};

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
	// Both remaining variants always carry a resolved projectRoot (issue
	// #252) -- render it so the agent can see which root actually ran
	// (or was resolved for a no-match) without cross-checking
	// structuredContent.
	const rootLine = `\nProject root: \`${data.projectRoot}\``;
	if (data.kind === "no-match") return `${formatNoMatchMarkdown(data.filter)}${rootLine}`;
	const classMap = new Map<string, string>(Object.entries(data.classifications));
	return `${formatReportMarkdown(data.report, classMap)}${rootLine}`;
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

export const RunTestsAsMarkdown = RunTestsResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatRunTestsMarkdown(data)),
		encode: SchemaGetter.forbidden(() => "RunTestsAsMarkdown is one-way."),
	}),
);

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
		Schema.toStandardSchemaV1(
			Schema.Struct({
				files: Schema.optional(Schema.Array(Schema.String)),
				project: Schema.optional(Schema.String),
				tags: Schema.optional(TagFilter),
				passWithNoTests: Schema.optional(Schema.Boolean),
				timeout: Schema.optional(Schema.Number),
				// Issue #252: the MCP server freezes its Vitest `root` at boot
				// (`ctx.cwd`) and cannot observe a caller's cwd. When supplied,
				// this overrides that root -- but only after validation (see
				// `validateProjectRoot`): it must be an existing directory
				// belonging to the same git repository as `ctx.cwd` (checked via
				// `git rev-parse --git-common-dir`, identical across a repo and
				// all its worktrees). A path in a different repo, or a
				// non-existent path, returns `{ kind: "error" }` naming both
				// paths -- never a silent fallback to `ctx.cwd`. The resolved
				// root actually used is always echoed back on `RunTestsOk` /
				// `RunTestsNoMatch`, whether or not this was supplied.
				projectRoot: Schema.optional(Schema.String),
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

				// Issue #252: validate (never trust) an explicit projectRoot
				// before it can influence anything below. A rejection returns
				// the tool's normal error envelope and never reaches
				// createVitest — this must happen before any Vitest/coverage
				// setup so a mismatched root can't leak into a real run.
				const projectRootValidation = await validateProjectRoot(input.projectRoot, ctx.cwd);
				if (!projectRootValidation.ok) {
					return { kind: "error" as const, message: projectRootValidation.message };
				}
				const resolvedRoot = projectRootValidation.root;

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
				// invoked. Keeps the MCP server startup fast. Issue #303: resolve
				// the specifier anchored at `resolvedRoot` (see
				// `resolveVitestNodeEntry`) rather than importing the bare
				// "vitest/node" specifier, which would resolve relative to this
				// package's own install location and can silently drive a
				// DIFFERENT physical vitest copy than the one the project under
				// test imports — corrupting the module-level SnapshotClient
				// singleton and failing every snapshot assertion. Routed through
				// `vitestLoader.load` (rather than a bare `await import(...)`
				// here) because vitest's own vite-node externalizes the
				// "vitest"/"vitest/node" package for every importer, but only
				// special-cases AST-literal `import("vitest/node")` call sites
				// for `vi.mock` interception — a computed specifier (required
				// here, since the whole point is to resolve a DIFFERENT physical
				// path per call) silently bypasses mocking and loads the real
				// module. `vitestLoader` is a plain mutable object so tests can
				// substitute `.load` directly (property mutation on a shared
				// object reference, no `vi.mock` needed).
				const { createVitest } = await vitestLoader.load(resolveVitestNodeEntry(resolvedRoot));

				let vitest: Awaited<ReturnType<typeof createVitest>> | undefined;
				let covOverride: ReturnType<typeof makeCoverageDirOverride> | undefined;

				try {
					// Assigned inside the try (not before it) so a throwing
					// mkdtempSync — e.g. a full or read-only tmpdir — is caught
					// by the surrounding catch and returns the tool's normal
					// `{ kind: "error", message }` shape instead of propagating
					// raw out of the tRPC resolver.
					covOverride = makeCoverageDirOverride();
					vitest = await createVitest(
						"test",
						{
							root: resolvedRoot,
							run: true,
							// Inherit coverage from the user's vitest.config (enabled,
							// provider, thresholds all still apply — this spreads
							// `coverage.reportsDirectory` as a field-level merge, not a
							// replacement). Forcing `enabled: false` here was overriding
							// intentional "coverage on by default" configurations and
							// forced the orchestrator to make a parallel Bash --coverage
							// call just to populate file_coverage rows.
							coverage: covOverride.coverage,
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
							projectRoot: resolvedRoot,
							filter: {
								project: project ?? null,
								files,
								tags: tagsInput ?? null,
								resolvedExpression,
							},
						};
					}

					const preliminaryReason =
						unhandledErrors.length > 0 || result.testModules.some((m) => m.state() === "failed") ? "failed" : "passed";

					const baseReport = buildAgentReport(testModules, unhandledErrors, preliminaryReason, {
						omitPassingTests: true,
					});
					// buildAgentReport self-corrects reason for suite/collection failures.
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
						projectRoot: resolvedRoot,
						scope: {
							project: project ?? null,
							files,
							tags: tagsInput ?? null,
						},
						report,
						classifications: classifications ? Object.fromEntries(classifications) : {},
						discoveryLastScannedAt: readDiscoveryLastScannedAt() ?? null,
					};
				} catch (err) {
					// Exception-safe error extraction: a hostile thrown value (a
					// throwing `message` getter or `toString`) must still produce
					// the `{ kind: "error" }` envelope, never a raw tRPC rejection.
					let message: string;
					try {
						if (err instanceof Error && err.message === "VITEST_TIMEOUT") {
							return { kind: "timeout" as const, timeoutSeconds: input.timeout ?? 120 };
						}
						message = err instanceof Error ? err.message : String(err);
					} catch {
						message = coerceErrorField(err, "message") ?? "<unserializable error>";
					}
					return { kind: "error" as const, message };
				} finally {
					// Nested finally: a rejecting `vitest.close()` must not skip the
					// stream teardown or the coverage tmpdir removal.
					try {
						await vitest?.close();
					} finally {
						nullStream.destroy();
						if (covOverride !== undefined) {
							try {
								rmSync(covOverride.dir, { recursive: true, force: true });
							} catch {
								// best-effort cleanup; tmpdir reaping will get it eventually
							}
						}
					}
				}
			}),
	);

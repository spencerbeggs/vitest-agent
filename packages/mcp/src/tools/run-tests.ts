import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { ModuleResolution } from "@effected/commands/node-sync";
import type { ProcessScopeError } from "@effected/engine";
import { Exclusive, ProcessScope } from "@effected/engine";
import { Git, TreeIdentity } from "@effected/git";
import { ToolOutputSchema } from "@effected/mcp";
import { StdioCapture } from "@effected/mcp/node";
import { Walker } from "@effected/walker";
import { DataReader, DataStore } from "@vitest-agent/engine";
import type { AgentReport, ConsoleLeakTask, VitestModuleError } from "@vitest-agent/sdk";
import {
	AgentReport as AgentReportSchema,
	RunDiagnostics,
	SuggestedActionRecord,
	VITEST_CONFIG_FILES,
	buildAgentReport,
	buildConsoleLeaks,
	coerceErrorField,
	collectConsoleLeakEntries,
	formatScopedCoverageNote,
	readStrayOutput,
	suggestedActionsFromRunDiagnostics,
} from "@vitest-agent/sdk";
import type { Fiber, Scope } from "effect";
import { Context, Data, Effect, FileSystem, Layer, Option, Path, Result, Schema } from "effect";
import { Tool } from "effect/ai";
import type { CurrentSessionIdRef, SessionContextRef } from "../session.js";
import { McpSession } from "../session.js";

const TagFilter = Schema.Struct({
	all: Schema.optionalKey(Schema.Array(Schema.String)).annotate({ description: "Require every listed tag" }),
	any: Schema.optionalKey(Schema.Array(Schema.String)).annotate({ description: "Require at least one listed tag" }),
	none: Schema.optionalKey(Schema.Array(Schema.String)).annotate({ description: "Exclude any listed tag" }),
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
	scopedNote: Schema.optional(Schema.NullOr(Schema.String)).annotate({
		description:
			"Set (issue #160) when this call was scoped to a subset of the project's test files (files/project/tags " +
			"filter supplied). Vitest enforces coverage.thresholds against the whole-project denominator regardless of " +
			"how many files ran, so a scoped run's threshold check is unreliable; this note explains why no coverage " +
			"verdict should be trusted for this call. `null`/absent means the run was unscoped.",
	}),
	suggestedActions: Schema.optionalKey(Schema.Array(SuggestedActionRecord)).annotate({
		description:
			"Run-level suggested actions the plugin raised at config time (issue #544): one entry per coverage-config " +
			"diagnostic the plugin's ConfigValidation reported, such as a coverageTargets metric with no matching " +
			"coverage.thresholds floor (severity warn). The same entries print on the plugin's stderr for a human and in " +
			"the rendered report's Actions trailer. Absent when the project's config validated clean or does not load " +
			"the plugin. Includes the actions derived from `runDiagnostics`, after the config ones.",
	}),
	runDiagnostics: Schema.optionalKey(RunDiagnostics).annotate({
		description:
			"Run-level diagnostics the plugin reporter published for this run (issue #544): Vitest performance hints, " +
			"post-run timing (persist, coverage scan, total) and whether results were persisted. Their suggested actions are merged into " +
			"`suggestedActions`. Absent when the project does not load the plugin.",
	}),
}).annotate({ identifier: "RunTestsOk" });

const RunTestsTimeout = Schema.Struct({
	kind: Schema.Literal("timeout"),
	timeoutSeconds: Schema.Number,
}).annotate({ identifier: "RunTestsTimeout" });

/**
 * The machine-readable reasons a `run_tests` error result may carry. Only
 * failures an agent must act on in a specific way get one; the rest stay
 * message-only. `stale-install` (issue #461): the `vitest/node` entry this
 * long-lived server resolved for the project no longer exists on disk
 * because the dependency tree was reinstalled under it — the remedy is to
 * restart the MCP server (`/mcp` in Claude Code), not to retry the call.
 */
export const RUN_TESTS_ERROR_REASONS = ["stale-install"] as const;

const RunTestsError = Schema.Struct({
	kind: Schema.Literal("error"),
	message: Schema.String,
	reason: Schema.optionalKey(Schema.Literals(RUN_TESTS_ERROR_REASONS)).annotate({
		description:
			"Set when the failure has a specific remedy. `stale-install`: the vitest/node entry this server resolved for the project vanished from disk (the dependency tree was reinstalled under the long-lived server); `message` names the missing path. Restart the MCP server (/mcp in Claude Code) — retrying the call cannot fix it. Absent for a message-only error.",
	}),
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

/**
 * The `run_tests` tool's success payload.
 *
 * @public
 */
export const RunTestsResult = ToolOutputSchema.objectRooted(
	Schema.Union([RunTestsOk, RunTestsTimeout, RunTestsError, RunTestsNoMatch]),
).annotate({
	identifier: "RunTestsResult",
	title: "run_tests result",
	description:
		"Discriminate on `kind`. ok carries the full AgentReport plus per-test classifications; timeout / error are the two failure modes; no-match indicates that the resolved filter set matched zero test cases.",
});
/**
 * The decoded {@link RunTestsResult}.
 *
 * @public
 */
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

// Same handshake for the plugin's config-time suggested actions (issue #544):
// `configureVitest` maps its `ConfigValidation` warnings onto
// `SuggestedActionRecord`s and publishes them on the Vitest instance it was
// handed under this `Symbol.for` key; the plugin's own stderr line is the
// human copy. The nested Vitest below is that instance, so the slot is read
// off it once the run has finished.
const CONFIG_SUGGESTED_ACTIONS_SYMBOL = Symbol.for("vitest-agent:config-suggested-actions");

/**
 * Reads the config-derived suggested actions the plugin published on a
 * Vitest instance. `undefined` when none were published (the project does
 * not load the plugin, or its config validated clean). Each entry is
 * decoded against `SuggestedActionRecord` so a foreign shape can never
 * reach the wire.
 *
 * @internal
 */
export function readConfigSuggestedActions(vitest: object): ReadonlyArray<SuggestedActionRecord> | undefined {
	const value = (vitest as Record<symbol, unknown>)[CONFIG_SUGGESTED_ACTIONS_SYMBOL];
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const decoded = Schema.decodeUnknownResult(Schema.Array(SuggestedActionRecord))(value);
	return Result.isSuccess(decoded) ? decoded.success : undefined;
}

// Same handshake for the plugin's run diagnostics (issue #544): the plugin
// reporter publishes `RunDiagnostics` on the Vitest instance under this key;
// each run overwrites it. mcp never imports plugin, so it is redeclared.
const RUN_DIAGNOSTICS_SYMBOL = Symbol.for("vitest-agent:run-diagnostics");

/**
 * Reads the run diagnostics the plugin published on a Vitest instance.
 * `undefined` when none were published (no plugin, or a clean run) or the
 * slot holds a foreign shape; the value is decoded against `RunDiagnostics`.
 *
 * @internal
 */
export function readRunDiagnostics(vitest: object): RunDiagnostics | undefined {
	const value = (vitest as Record<symbol, unknown>)[RUN_DIAGNOSTICS_SYMBOL];
	if (value === undefined || value === null) return undefined;
	const decoded = Schema.decodeUnknownResult(RunDiagnostics)(value);
	return Result.isSuccess(decoded) ? decoded.success : undefined;
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
 * Removed when the run's scope closes. The removal ignores a failure (a
 * directory already gone, a tmpdir reaper racing it): core's
 * `makeTempDirectoryScoped` dies on one, which would turn a finished run into
 * a defect.
 */
const coverageTempDirectory = Effect.flatMap(FileSystem.FileSystem, (fs) =>
	Effect.acquireRelease(fs.makeTempDirectory({ prefix: "vitest-agent-cov-" }), (dir) =>
		fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore),
	),
);

/**
 * Typed wrapper for a rejected step of the run (loading `vitest/node`,
 * `createVitest`, `vitest.start`, the coverage temp dir). Keeps the run's
 * error channel a tagged union so the timeout branches are recovered by tag
 * (issue #320), and carries the raw cause for the `{ kind: "error" }` message.
 */
class RunStepFailure extends Data.TaggedError("RunStepFailure")<{ readonly cause: unknown }> {}

/**
 * The stdio capture `run_tests` diverts the nested Vitest run's
 * `process.stdout` / `process.stderr` writes through, so a user reporter's
 * `console.log` never reaches the JSON-RPC wire while every other tool
 * handler (and the transport) keeps writing normally. `main.ts` installs it
 * once at boot and provides it; the default installs it on first use for an
 * embedder or a test that never ran `main.ts` (installing is idempotent per
 * stream).
 *
 * @internal
 */
export const RunTestsStdio = Context.Reference<StdioCapture>("@vitest-agent/mcp/RunTestsStdio", {
	defaultValue: () => StdioCapture.install(process),
});

/** Both streams discarded for the run's own async context. */
const DISCARD_STDIO = { stdout: StdioCapture.discard, stderr: StdioCapture.discard } as const;

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

/**
 * The git common directory for `dir` (`Git.commonDir`: `git rev-parse
 * --path-format=absolute --git-common-dir`) — identical across a
 * repository, its subdirectories, every linked worktree and any symlinked
 * path to them, which is what makes it the right "same repository"
 * comparison (`--show-toplevel` differs per worktree). Yields `null` when
 * `dir` is not inside a git repository or the command fails for any other
 * reason; callers treat `null` as "cannot confirm same repository", never
 * as a silent pass.
 */
const gitCommonDir = (dir: string): Effect.Effect<string | null, never, Git> =>
	Effect.flatMap(Git, (git) => git.commonDir(dir)).pipe(
		Effect.option,
		Effect.map(Option.getOrNull),
		Effect.catchDefect(() => Effect.succeed(null)),
	);

export type ProjectRootValidation = { ok: true; root: string } | { ok: false; message: string };

// Issue #259 under Vitest 5: `findConfigFile(root)` (vitest@5.0.0,
// `node/config/resolveConfig.ts`) probes ONLY the given `root` for
// `vitest.config.*` / `vite.config.*` and returns `false` otherwise —
// there is no ancestor walk. A `root` pointing at a monorepo package
// subtree therefore finds NOTHING: the run boots on pure defaults, never
// loads `AgentPlugin`, writes no DB rows, and still reports success.
// (History: Vitest 4 did walk up, found the repo-root config, and then
// mis-resolved its relative `globalSetup` against the subtree — the
// original #259 bug. Both failure modes have the same cure below.)
//
// `resolveConfigAnchoredRoot` walks UP from `startDir` looking for the
// config, returning the directory that holds it, so the default (no
// `projectRoot`) path always hands Vitest a root whose own directory
// carries the config. `resolveAnchoredConfigFile` returns the config
// PATH from that same walk, so the explicit-`projectRoot` path — which
// must keep using the caller's root verbatim — can pass `config:`
// alongside it and get the config the anchored walk found. An
// explicit `projectRoot` plus the anchored `config:` still resolves that
// config's relative `setupFiles` / `globalSetup` against the SUPPLIED
// root, not the config's own directory, so callers should pass the
// directory that holds the config when the config uses relative setup
// paths.
// Candidate filenames are checked per-directory in the order Vitest
// itself prefers: sdk's `VITEST_CONFIG_FILES` (`vitest.config.*` before
// `vite.config.*`, across ts/mts/cts/js/mjs/cjs). The walk is bounded at the git work-tree root
// (`git rev-parse --show-toplevel`, which a linked worktree answers with
// its own root) so an unrelated `vite.config.ts` sitting above the repo
// can't silently capture the root. Neither helper ever fails.
//
// Issue #384: both helpers run on `@effected/walker` and `@effected/git`
// over injected `FileSystem` / `Path` / `Git` services, so tests drive them
// through an in-memory volume and a `Git` double; the promise-shaped run
// body provides the Node platform via `runOnNodePlatform`.

/** What the config walk reads: the filesystem, path ops, and git. */
type ConfigWalkServices = FileSystem.FileSystem | Path.Path | Git;

/**
 * The one walk both anchoring helpers share: step UP from `startDir`
 * until a vitest/vite config file is found, returning its absolute path.
 * Bounded at the git work-tree root (inclusive, so the root is still
 * examined) and at the filesystem root. `Git.repoRoot` answers a PHYSICAL
 * path (`/private/var/...` for a `/var/...` tmpdir on macOS) while the chain
 * is lexical, so the bound is `Walker.ascendWithin`, which stops on a
 * realpath match; a lexical `stopAt` would match nothing there and let the
 * walk run past the repository. Any `repoRoot` failure (not a repository,
 * git missing) means no git bound: the walk runs to the filesystem root, as
 * it always has outside a repository. Yields `null` when no config is found in
 * range. An unreadable entry reads as absent (the walker absorbs
 * per-candidate failures), and a defect anywhere in the walk also yields
 * `null`, so the helper never fails.
 */
const walkUpToConfigFile = (startDir: string): Effect.Effect<string | null, never, ConfigWalkServices> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const start = path.resolve(startDir);
		const git = yield* Git;
		const dirs = yield* Walker.ascendWithin(start, yield* Effect.option(git.repoRoot(start)));
		const found = yield* Walker.findUpward(dirs, (dir) => VITEST_CONFIG_FILES.map((name) => path.join(dir, name)));
		return Option.getOrNull(found);
	}).pipe(Effect.catchDefect(() => Effect.succeed(null)));

/**
 * Walk UP from `startDir` looking for the vitest/vite config file, yielding
 * its absolute path, or `null` when none is found in range.
 *
 * @internal exported for tests
 */
export const resolveAnchoredConfigFile = (startDir: string): Effect.Effect<string | null, never, ConfigWalkServices> =>
	walkUpToConfigFile(startDir);

/**
 * Walk UP from `startDir` looking for the vitest/vite config Vitest would
 * load anyway, yielding the directory that holds it. Yields `startDir`
 * unchanged when no config is found in range. See the issue #259 comment
 * above `validateProjectRoot` for the full rationale.
 *
 * @internal exported for tests
 */
export const resolveConfigAnchoredRoot = (startDir: string): Effect.Effect<string, never, ConfigWalkServices> =>
	Effect.gen(function* () {
		const found = yield* walkUpToConfigFile(startDir);
		if (found === null) return startDir;
		const path = yield* Path.Path;
		return path.dirname(found);
	});

const NodeFsPath = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** The Node platform the promise-shaped run body walks the real disk with; bound once so it memoizes. */
const NodeWalkPlatform = Git.layer.pipe(Layer.provide(NodeChildProcessSpawner.layer), Layer.provideMerge(NodeFsPath));

/** Run a never-failing platform walk against the real disk. */
const runOnNodePlatform = <A>(effect: Effect.Effect<A, never, ConfigWalkServices>): Promise<A> =>
	Effect.runPromise(Effect.provide(effect, NodeWalkPlatform));

/**
 * Validate an optional caller-supplied `projectRoot` against `ctxCwd`
 * (the MCP server's boot-time root). `undefined` anchors at the directory
 * of the vitest/vite config Vitest would load anyway (issue #259, via
 * `resolveConfigAnchoredRoot`) — never inferred beyond that, never
 * defaulted to anything else when no config is found in range.
 *
 * A supplied `projectRoot` is VALIDATED, not trusted, and used VERBATIM
 * once validated — explicit is explicit, no anchoring applied to `root`.
 * It must resolve to an existing directory that shares a git common
 * directory with `ctxCwd` (same repository, including across worktrees).
 * Any failure returns `{ ok: false, message }` naming both paths — never a
 * silent fallback to `ctxCwd`, never a raw throw. The CONFIG for such a
 * root is resolved separately by the caller via
 * `resolveAnchoredConfigFile`, because Vitest 5 no longer walks up to find
 * one.
 *
 * @internal exported for tests
 */
export async function validateProjectRoot(
	projectRoot: string | undefined,
	ctxCwd: string,
): Promise<ProjectRootValidation> {
	if (projectRoot === undefined) {
		return { ok: true, root: await runOnNodePlatform(resolveConfigAnchoredRoot(ctxCwd)) };
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
	const [rootCommonDir, cwdCommonDir] = await runOnNodePlatform(
		Effect.all([gitCommonDir(resolvedRoot), gitCommonDir(ctxCwd)], { concurrency: 2 }),
	);
	if (rootCommonDir === null || cwdCommonDir === null || rootCommonDir !== cwdCommonDir) {
		return {
			ok: false,
			message: `projectRoot "${resolvedRoot}" does not belong to the same git repository as ctx.cwd "${ctxCwd}".`,
		};
	}
	return { ok: true, root: resolvedRoot };
}

/**
 * The tree identity for `dir` (`Git.treeIdentity`: its physical toplevel and
 * the shared common dir, from one `git rev-parse`), or `None` when git cannot
 * answer (not a repository, a bare repository, git failure). Git answers
 * physical paths, so identities are only ever compared with each other.
 */
const treeIdentityOf = (dir: string): Effect.Effect<Option.Option<TreeIdentity>, never, Git> =>
	Effect.flatMap(Git, (git) => git.treeIdentity(dir)).pipe(
		Effect.orElseSucceed(() => Option.none<TreeIdentity>()),
		Effect.catchDefect(() => Effect.succeed(Option.none<TreeIdentity>())),
	);

/**
 * Issue #275: refuse a call whose hook-injected `_callerCwd` sits in a
 * DIFFERENT working tree of the same repository than the root the run would
 * use. Anything indeterminate (absent, empty, relative, nonexistent, not a
 * directory, outside git, a different repository) proceeds: the server
 * cannot tell, and refusing on absence would break every non-plugin
 * consumer.
 *
 * @internal exported for tests
 */
export async function checkCallerWorktree(
	callerCwd: string | undefined,
	resolvedRoot: string,
): Promise<ProjectRootValidation> {
	if (callerCwd === undefined || callerCwd === "" || !isAbsolute(callerCwd)) return { ok: true, root: resolvedRoot };
	const isDirectory = await stat(callerCwd).then(
		(s) => s.isDirectory(),
		() => false,
	);
	if (!isDirectory) return { ok: true, root: resolvedRoot };
	const [caller, root] = await runOnNodePlatform(
		Effect.all([treeIdentityOf(callerCwd), treeIdentityOf(resolvedRoot)], { concurrency: 2 }),
	);
	// Issue #275: only a PRESENT pair of identities in the same repository
	// but different working trees refuses; `None` on either side means
	// "cannot tell" and proceeds, as does a different repository.
	if (Option.isNone(caller) || Option.isNone(root)) return { ok: true, root: resolvedRoot };
	if (TreeIdentity.relation(caller.value, root.value) !== "sibling-worktree") return { ok: true, root: resolvedRoot };
	return {
		ok: false,
		message: `This call came from the working tree "${caller.value.toplevel}" but the Vitest root resolved to "${root.value.toplevel}", a different working tree of the same repository, so the run would report results for the wrong tree. Pass projectRoot (the absolute path of your own working tree, "${caller.value.toplevel}") to run there.`,
	};
}

/**
 * Issue #303: resolve `vitest/node` anchored at the run's project root
 * instead of the bare `"vitest/node"` specifier, which resolves relative to
 * `@vitest-agent/mcp`'s OWN install location. `vitest` is a peerDependency
 * of this package, and pnpm routinely materializes MORE THAN ONE physical
 * instance of the same vitest version when peer-resolution hashes differ
 * (e.g. `vitest@<version>_@types+node@26.2.0_...` alongside
 * `vitest@<version>_@types+node@26.3.0_...` under `node_modules/.pnpm`). When
 * the bare specifier resolves to a DIFFERENT physical copy than the one the
 * project's test files import, `SnapshotClient.setup()` runs against one
 * copy's module-level `_client` singleton while `expect(...).toMatchSnapshot()`
 * inside the test file goes through the other copy's singleton, which has
 * no state — every snapshot assertion then fails with "The snapshot state
 * for '<file>' is not found. Did you call 'SnapshotClient.setup()'?" while
 * every non-snapshot assertion still passes.
 *
 * Resolution is `ModuleResolution.resolve` from `@effected/commands`,
 * anchored at `root` (a directory works as-is). vitest's package.json
 * `exports` map for `./node` carries a `default` condition, so CommonJS
 * resolution finds it even though vitest itself is ESM; the answer is the
 * real path (Node's resolver follows symlinks), which is the spelling that
 * identifies the module instance.
 *
 * Falls back to the bare `"vitest/node"` specifier when root-anchored
 * resolution finds nothing (e.g. a project root with no local vitest
 * install) so that case keeps working exactly as it did before this fix.
 *
 * The property this buys — one module instance shared by the server and the
 * project's test files — is pinned by `vitest-node-module-identity.test.ts`
 * (issue #387), which asserts realpath AND `Object.is` identity against the
 * live repo layout, so a pnpm layout change that reintroduces two copies
 * fails there rather than as a snapshot failure in a consumer's run.
 *
 * @internal exported for tests
 */
export function resolveVitestNodeEntry(root: string): string {
	return Option.getOrElse(ModuleResolution.resolve("vitest/node", { from: root }), () => "vitest/node");
}

/**
 * Issue #461: the MCP server is long-lived. When the lockfile is regenerated
 * mid-session (dep bump, branch switch), pnpm can rename vitest's `.pnpm`
 * store directory (peer-hash change), so the entry resolved for this process
 * no longer exists and every run would otherwise fail opaquely inside the fork
 * pool ("Worker forks emitted error", total: 0). Returns an actionable message
 * when `entry` (an absolute path or a `file://` URL) is missing on disk
 * (`ModuleResolution.isStale`, which checks the exact path that will be
 * imported), else `null`. The bare `"vitest/node"` fallback is not a path and
 * is never stale.
 *
 * @internal exported for tests
 */
export function staleInstallMessage(entry: string): string | null {
	if (!ModuleResolution.isStale(entry)) return null;
	const path = entry.startsWith("file:") ? fileURLToPath(entry) : entry;
	return `The resolved vitest entry "${path}" no longer exists on disk. The install changed since this vitest-agent MCP server loaded it (for example the lockfile was regenerated by a dependency install or branch switch). Restart the vitest-agent MCP server (in Claude Code: /mcp) or restart the session, then retry.`;
}

/** What `run_tests` needs from the loaded `vitest/node` module. */
interface VitestNodeModule {
	readonly createVitest: typeof import("vitest/node")["createVitest"];
}

/**
 * The test seam around resolving and importing `vitest/node`. vitest's own
 * vite-node externalizes "vitest"/"vitest/node" for every importer, and
 * `vi.mock("vitest/node", ...)` only intercepts AST-literal
 * `import("vitest/node")` call sites — a computed specifier (unavoidable
 * here; see `resolveVitestNodeEntry`) silently bypasses it. So the import is
 * `ModuleResolution.load` with an injectable `importer`: tests substitute
 * `.load` (the importer, called with the entry as a `file:` URL or the bare
 * fallback specifier) and `.resolveEntry` by mutating this shared object,
 * no `vi.mock` required. `load` is `undefined` in production, which is
 * `ModuleResolution.load`'s own dynamic `import()`.
 *
 * @internal exported for tests
 */
export const vitestLoader: {
	resolveEntry: (root: string) => string;
	load: ((url: string) => Promise<unknown>) | undefined;
} = {
	resolveEntry: (root) => resolveVitestNodeEntry(root),
	load: undefined,
};

/**
 * The one-permit lane every `run_tests` body runs in. The body assigns the
 * active attribution UUIDs into `process.env.VITEST_AGENT_*`, enters the run's
 * root with `chdir`, and then awaits `createVitest` / `vitest.start`, which
 * spawns the worker pool that snapshots env (and cwd) at spawn time. Two
 * interleaved tool calls would race: caller B's env assignment can land
 * between A's assignment and A's worker spawn, attributing A's results to B's
 * agent. `Exclusive` keeps the whole body atomic against every other
 * `run_tests` call in this process; its scope restores env and cwd before the
 * next call starts, and a client cancel (an interrupt of the request fiber)
 * only drops the response — the permit is held until the body ends.
 */
const runTestsLane = Effect.runSync(Exclusive.make);

/**
 * How long a run may hold the lane beyond its own test timeout: config
 * loading (`createVitest`), the classification read, and teardown. The test
 * timeout itself bounds only `vitest.start`, as it always has.
 */
const LANE_ALLOWANCE_MS = 120_000;

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
 * The `run_tests` tool's parameters. `tags` and `_sessionContext` are
 * nested structs and are served strict at their own level (issue #243).
 *
 * @public
 */
export const RunTestsInput = Schema.Struct({
	files: Schema.optionalKey(Schema.Array(Schema.String)).annotate({ description: "Test file paths to run" }),
	project: Schema.optionalKey(Schema.String).annotate({ description: "Project name to filter" }),
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
	projectRoot: Schema.optionalKey(Schema.String).annotate({
		description:
			"Explicit Vitest root for this call, used verbatim. Omit it to get the config-anchored default (walk up from the server's boot dir for a vitest/vite config, bounded at the git root). Prefer an absolute path; a relative path is resolved against ctx.cwd, not the server process's cwd. Validated: must be an existing directory in the same git repository as ctx.cwd (same git-common-dir, compared via `git rev-parse --path-format=absolute --git-common-dir`, which requires git 2.31 or newer; e.g. a sibling worktree). Rejected with { kind: 'error' } naming both paths otherwise.",
	}),
	tags: Schema.optionalKey(TagFilter).annotate({
		description: "Structured tag filter; all/any/none AND together with each other and with project/files",
	}),
	passWithNoTests: Schema.optionalKey(Schema.Boolean).annotate({
		description: "Per-call override of Vitest's native test.passWithNoTests",
	}),
	timeout: Schema.optionalKey(Schema.Finite).annotate({ description: "Timeout in seconds (default: 120)" }),
	// Issue #275: injected by the same hook from the payload `.cwd`, the
	// invoking agent's working directory. The handler compares its git
	// toplevel to the resolved root's and refuses only a same-repository,
	// different-worktree mismatch; absent or indeterminate proceeds.
	_callerCwd: Schema.optionalKey(Schema.String).annotate({
		description: "Hook-injected caller working directory; do not pass manually.",
	}),
	// Injected by the `pre-tool-use-mcp-run-tests.sh` hook —
	// agents do not pass this directly. Carries the recovered
	// VITEST_AGENT_* attribution UUIDs because Claude Code does
	// not auto-source CLAUDE_ENV_FILE into MCP children.
	_sessionContext: Schema.optionalKey(
		Schema.Struct({
			chatId: Schema.String,
			conversationId: Schema.String,
			mainAgentId: Schema.String,
		}),
	).annotate({ description: "Hook-injected session attribution UUIDs; do not pass manually." }),
});
/**
 * The decoded {@link RunTestsInput}.
 *
 * @public
 */
export type RunTestsInputType = Schema.Schema.Type<typeof RunTestsInput>;

/**
 * The filter set a `run_tests` call resolves from its input alone: the
 * sanitized `files` / `project`, the caller's `tags` verbatim, the Vitest
 * tag expression composed from them, and whether any filter applies.
 *
 * @internal exported for tests
 */
export interface RunScope {
	readonly files: string[];
	readonly project: string | undefined;
	readonly tags: TagFilterType | undefined;
	readonly resolvedExpression: string | null;
	readonly hasFilter: boolean;
}

type RunTestsOkType = Extract<RunTestsResultType, { kind: "ok" }>;
type RunTestsNoMatchType = Extract<RunTestsResultType, { kind: "no-match" }>;

/**
 * Derive the run's {@link RunScope} from its input. Every file, project and
 * tag value passes through `sanitizeTestArgs` (tag values ride into Vitest's
 * tag-expression compiler unmodified, so shell metacharacters are rejected
 * the same way); a refused argument fails with the message the tool returns
 * as its `{ kind: "error" }` result. An all-empty tag filter composes to no
 * expression and so is not a filter.
 *
 * @internal exported for tests
 */
export function deriveRunScope(
	input: Pick<RunTestsInputType, "files" | "project" | "tags">,
): Result.Result<RunScope, string> {
	const tags = input.tags;
	try {
		const files = input.files ? sanitizeTestArgs(input.files) : [];
		const project = input.project ? sanitizeTestArgs([input.project])[0] : undefined;
		if (tags) {
			if (tags.all) sanitizeTestArgs(tags.all);
			if (tags.any) sanitizeTestArgs(tags.any);
			if (tags.none) sanitizeTestArgs(tags.none);
		}
		const resolvedExpression = composeTagExpression(tags ?? null);
		const hasFilter = files.length > 0 || project !== undefined || resolvedExpression !== null;
		return Result.succeed({ files, project, tags, resolvedExpression, hasFilter });
	} catch (err) {
		return Result.fail(err instanceof Error ? err.message : String(err));
	}
}

/**
 * Whether a finished run is `no-match`: a filter was supplied, no test
 * module was collected, and no unhandled error was raised. Filter-driven,
 * not result-driven — an unfiltered empty run is `ok`, and the
 * `passWithNoTests` policy never reshapes the discriminator.
 *
 * @internal exported for tests
 */
export function isNoMatch(scope: RunScope, testModuleCount: number, unhandledErrorCount: number): boolean {
	return scope.hasFilter && testModuleCount === 0 && unhandledErrorCount === 0;
}

/**
 * Shape the `no-match` result, echoing the resolved filter verbatim.
 *
 * @internal exported for tests
 */
export function toNoMatch(scope: RunScope, projectRoot: string): RunTestsNoMatchType {
	return {
		kind: "no-match" as const,
		projectRoot,
		filter: {
			project: scope.project ?? null,
			files: scope.files,
			tags: scope.tags ?? null,
			resolvedExpression: scope.resolvedExpression,
		},
	};
}

/**
 * Shape the `ok` result from a finished run's plain values. `project` is
 * echoed at the top level only when supplied; `scope` always echoes the
 * resolved filter set; absent classifications and scan time become `{}` and
 * `null`.
 *
 * @internal exported for tests
 */
export function toOkPayload(args: {
	readonly scope: RunScope;
	readonly projectRoot: string;
	readonly report: AgentReport;
	readonly classifications: ReadonlyMap<string, string> | undefined;
	readonly discoveryLastScannedAt: string | undefined;
	readonly scopedNote: string | null;
	/** Config-time suggested actions the plugin published (issue #544); omitted from the payload when absent or empty. */
	readonly suggestedActions?: ReadonlyArray<SuggestedActionRecord>;
	/** Run diagnostics the plugin published (issue #544); their actions follow the config actions. */
	readonly runDiagnostics?: RunDiagnostics;
}): RunTestsOkType {
	const { scope } = args;
	const suggestedActions = [
		...(args.suggestedActions ?? []),
		...(args.runDiagnostics !== undefined ? suggestedActionsFromRunDiagnostics(args.runDiagnostics) : []),
	];
	return {
		kind: "ok" as const,
		...(scope.project !== undefined && { project: scope.project }),
		projectRoot: args.projectRoot,
		scope: {
			project: scope.project ?? null,
			files: scope.files,
			tags: scope.tags ?? null,
		},
		report: args.report,
		classifications: args.classifications ? Object.fromEntries(args.classifications) : {},
		discoveryLastScannedAt: args.discoveryLastScannedAt ?? null,
		scopedNote: args.scopedNote,
		...(suggestedActions.length > 0 ? { suggestedActions } : {}),
		...(args.runDiagnostics !== undefined && { runDiagnostics: args.runDiagnostics }),
	};
}

/** What the run body reads from the session. */
interface RunTestsContext {
	readonly cwd: string;
	readonly currentSessionId: CurrentSessionIdRef;
	readonly sessionContext: SessionContextRef;
}

/**
 * Build the best-effort runner for a `RunTestsContext`: forks the effect
 * as a fiber on the provided services with its expected failure channel
 * ignored (`Effect.ignore`), so a typed failure never touches the tool
 * result (issue #330). Defects and interrupts are NOT absorbed — a bug in
 * the forked effect still surfaces through the runtime's fiber logging
 * rather than being hidden. Returns the fiber so a test can await its exit.
 *
 * @internal
 */
export const makeBestEffortFork =
	(services: Context.Context<DataReader | DataStore>) =>
	<A, E>(effect: Effect.Effect<A, E, DataReader | DataStore>): Fiber.Fiber<void> =>
		Effect.runFork(Effect.provideContext(effect.pipe(Effect.ignore), services));

/**
 * A rejected step's message. Exception-safe: a hostile thrown value (a
 * throwing `message` getter or `toString`) still yields a string, so the
 * `{ kind: "error" }` envelope always comes back.
 */
const errorMessage = (err: unknown): string => {
	try {
		return err instanceof Error ? err.message : String(err);
	} catch {
		return coerceErrorField(err, "message") ?? "<unserializable error>";
	}
};

/**
 * A promise-returning Vitest step, run through the lane's promise. By default
 * an interrupt aborts, then waits for the promise to settle; `abandon` resumes
 * at once instead, for a promise that ignores its signal.
 */
const step = <A>(
	evaluate: (signal: AbortSignal) => PromiseLike<A>,
	options?: { readonly abandon?: boolean },
): Effect.Effect<A, RunStepFailure> =>
	Exclusive.promise({ try: evaluate, catch: (cause) => new RunStepFailure({ cause }), ...options });

/** The Node platform the run's root validation, config walk and git reads use. */
const onNodePlatform = <A>(effect: Effect.Effect<A, never, ConfigWalkServices>): Effect.Effect<A> =>
	Effect.provide(effect, NodeWalkPlatform);

/**
 * The run itself, once the root, config and `vitest/node` entry are settled:
 * every step that can reject folds into `{ kind: "error" }`, and every
 * process-global change (cwd, the coverage temp dir, the Vitest instance) is
 * released by the lane's scope on every exit path.
 */
const runVitest = (args: {
	readonly input: RunTestsInputType;
	readonly ctx: RunTestsContext;
	readonly scope: RunScope;
	readonly resolvedRoot: string;
	readonly anchoredConfig: string | undefined;
	readonly vitestEntry: string;
}): Effect.Effect<
	RunTestsResultType,
	RunStepFailure | ProcessScopeError,
	DataReader | DataStore | FileSystem.FileSystem | Scope.Scope
> =>
	Effect.gen(function* () {
		const { input, ctx, scope, resolvedRoot, anchoredConfig, vitestEntry } = args;
		const { files, project, resolvedExpression, hasFilter } = scope;
		const timeoutSeconds = input.timeout ?? 120;

		// Issue #303: the entry is resolved anchored at `resolvedRoot` (see
		// `resolveVitestNodeEntry`) and imported through `vitestLoader`'s
		// injectable importer (a computed specifier defeats `vi.mock`).
		const { createVitest } = (yield* step(() =>
			ModuleResolution.load(vitestEntry, { importer: vitestLoader.load }),
		)) as VitestNodeModule;

		// Issue #512: `root` alone does not steer everything. A consumer
		// config that calls `AgentPlugin.discover()` with no args locates the
		// workspace via `process.cwd()` (and the reporter's dbPath, module
		// info and runScript lock read it too), which inside this long-lived
		// server is the BOOT checkout — so a sibling-worktree `projectRoot`
		// silently collected the main checkout's tests. Enter the validated
		// root for the run; the lane's scope restores the previous cwd before
		// the next call can start. When the previous cwd was deleted (a
		// removed worktree) `process.cwd()` throws: the run proceeds and
		// nothing is restored, there being nothing valid to restore to. Every
		// other tool reads its cwd from McpSession, not `process.cwd()`.
		yield* ProcessScope.chdir(process, resolvedRoot);
		// A failing temp dir (a full or read-only tmpdir) is the tool's normal
		// `{ kind: "error" }` result, never a raw failure.
		const coverageDir = yield* coverageTempDirectory.pipe(Effect.mapError((cause) => new RunStepFailure({ cause })));

		// The MCP server communicates over stdio, so the nested Vitest's own
		// Logger output must not reach stdout: its streams are a null
		// Writable. It must be a real stream — Vitest pipes worker output into
		// it (`pipe`, `setMaxListeners`), which a bare write sink cannot take.
		const nullStream = yield* Effect.acquireRelease(Effect.sync(StdioCapture.nullWritable), (stream) =>
			Effect.sync(() => stream.destroy()),
		);

		// Released first on every exit path, before the temp dir is removed
		// and cwd restored; a rejecting `close()` never skips that teardown.
		const vitest = yield* Effect.acquireRelease(
			step(() =>
				createVitest(
					{
						root: resolvedRoot,
						...(anchoredConfig !== undefined ? { config: anchoredConfig } : {}),
						run: true,
						// Inherit coverage from the user's vitest.config (enabled,
						// provider, thresholds all still apply — this spreads
						// `coverage.reportsDirectory` as a field-level merge, not a
						// replacement). Forcing `enabled: false` here was overriding
						// intentional "coverage on by default" configurations and
						// forced the orchestrator to make a parallel Bash --coverage
						// call just to populate file_coverage rows.
						coverage: { reportsDirectory: coverageDir },
						...(project ? { project } : {}),
						// Vitest's `tagsFilter: string[]` accepts one or more
						// tag-expression strings (AND-ed together). We compose
						// a single expression from the structured TagFilter
						// and pass it as a one-element array.
						...(resolvedExpression !== null ? { tagsFilter: [resolvedExpression] } : {}),
						// Per-call override of Vitest's native test.passWithNoTests.
						// When unset on the input we forward nothing, and Vitest
						// re-resolves the policy from the project config on disk.
						...(input.passWithNoTests !== undefined ? { passWithNoTests: input.passWithNoTests } : {}),
					},
					{}, // viteOverrides
					{
						stdout: nullStream as unknown as NodeJS.WriteStream,
						stderr: nullStream as unknown as NodeJS.WriteStream,
					},
				),
			),
			(instance) => Effect.tryPromise(() => instance.close()).pipe(Effect.ignore),
		);

		// Vitest's stdout/stderr options only cover Vitest-internal logging;
		// a user reporter calling `console.log` writes to `process.stdout`.
		// The capture diverts this run's async context to a discard sink
		// while every other tool handler and the transport keep the wire.
		//
		// Issue #320: the timeout is a typed `TimeoutError` recovered by tag,
		// never a string sentinel. `vitest.start` ignores abort signals, so on
		// timeout the start promise is abandoned and the scope's `close()`
		// tears the run down.
		const capture = yield* RunTestsStdio;
		const started = yield* step(
			() => capture.run(DISCARD_STDIO, () => vitest.start(files.length > 0 ? files : undefined)),
			{ abandon: true },
		).pipe(
			Effect.timeout(timeoutSeconds * 1000),
			Effect.map((value) => ({ outcome: "ok" as const, value })),
			Effect.catchTag("TimeoutError", () => Effect.succeed({ outcome: "timeout" as const })),
		);
		if (started.outcome === "timeout") {
			return { kind: "timeout" as const, timeoutSeconds };
		}
		const result = started.value;

		const testModules = result.testModules as unknown as Parameters<typeof buildAgentReport>[0];
		const unhandledErrors = coerceErrors(result.unhandledErrors);

		// Detect "no test cases matched the resolved filter set".
		// Tests-did-not-run vs tests-ran-and-passed is filter-driven, not
		// result-driven: an empty workspace with no filter is `ok` with
		// an empty report. The `passWithNoTests` policy controls
		// pass/fail classification only — it never reshapes the
		// discriminator.
		if (isNoMatch(scope, result.testModules.length, unhandledErrors.length)) {
			return toNoMatch(scope, resolvedRoot);
		}

		const preliminaryReason =
			unhandledErrors.length > 0 || result.testModules.some((m) => m.state() === "failed") ? "failed" : "passed";

		const baseReport = buildAgentReport(testModules, unhandledErrors, preliminaryReason, {
			omitPassingTests: true,
		});
		// buildAgentReport self-corrects reason for suite/collection failures.
		const leaks = buildConsoleLeaks(collectConsoleLeakEntries(vitest.state.getFiles() as unknown as ConsoleLeakTask[]));
		// What the run's workers (or a child process with inherited stdio)
		// wrote straight to their stdout/stderr, past Vitest's console
		// capture: recorded by the plugin's capture on the nested Vitest's
		// Logger, whose streams here are the null sink, so none of it reached
		// the JSON-RPC stdout. Absent when the project does not load the
		// plugin, or the plugin does not own the console (passthrough).
		const strayOutput = readStrayOutput(vitest.logger);
		// The plugin's config-time suggested actions (issue #544), published on
		// this nested Vitest instance by `configureVitest`.
		const configSuggestedActions = readConfigSuggestedActions(vitest);
		// The plugin's run diagnostics (issue #544), published the same way.
		const runDiagnostics = readRunDiagnostics(vitest);
		const report = {
			...baseReport,
			...(leaks !== undefined && { consoleLeaks: leaks }),
			...(strayOutput !== undefined && { strayOutput }),
		};

		// Read stored classifications from DB (written by the reporter via
		// classifyTest() during vitest.start). This avoids reimplementing
		// classification logic and stays consistent with AgentReporter.
		// Best-effort: a failed read never fails the tool.
		const classifications = yield* Effect.gen(function* () {
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
			return new Map(entries) as ReadonlyMap<string, string> | undefined;
		}).pipe(Effect.catchCause(() => Effect.succeed(undefined)));

		// Best-effort: associate the run with the current session so
		// session-scoped queries reflect this run. Never blocks the result.
		const chatId = ctx.currentSessionId.get();
		if (chatId !== null) {
			makeBestEffortFork(yield* Effect.context<DataReader | DataStore>())(
				Effect.gen(function* () {
					const store = yield* DataStore;
					yield* store.associateLatestRunWithSession({ chatId, invocationMethod: "mcp" });
				}),
			);
		}

		// Issue #160: a filtered call (files/project/tags) only exercises
		// a subset of the project's test files. Vitest enforces
		// coverage.thresholds against the whole-project denominator
		// regardless of how many files ran, so surface why a coverage
		// verdict from this call should not be trusted. Best-effort:
		// `globTestSpecifications()` failing (e.g. an unusual project
		// config) degrades to a note with no total-file count rather
		// than failing the whole call.
		let scopedNote: string | null = null;
		if (hasFilter) {
			const totalFileCount = yield* step(() => vitest.globTestSpecifications()).pipe(
				Effect.map((specs): number | undefined => specs.length),
				Effect.orElseSucceed(() => undefined),
			);
			scopedNote = formatScopedCoverageNote(testModules.length, totalFileCount);
		}

		return toOkPayload({
			scope,
			projectRoot: resolvedRoot,
			report,
			classifications,
			discoveryLastScannedAt: readDiscoveryLastScannedAt(),
			scopedNote,
			...(configSuggestedActions !== undefined && { suggestedActions: configSuggestedActions }),
			...(runDiagnostics !== undefined && { runDiagnostics }),
		});
	});

/**
 * The run body, inside the lane: input checks that return the tool's
 * `{ kind: "error" }` result before anything process-global changes, then
 * the attribution env and the run. Never fails.
 */
const runTestsBody = (
	input: RunTestsInputType,
	ctx: RunTestsContext,
): Effect.Effect<RunTestsResultType, never, DataReader | DataStore | FileSystem.FileSystem | Scope.Scope> =>
	Effect.gen(function* () {
		// A refused argument is the caller's to fix: return it as the tool's
		// error result (a thrown defect would reach the agent only as core's
		// scrubbed internal-error text).
		const derived = deriveRunScope(input);
		if (Result.isFailure(derived)) {
			return { kind: "error" as const, message: derived.failure };
		}
		const scope = derived.success;

		// Issue #252: validate (never trust) an explicit projectRoot
		// before it can influence anything below. A rejection returns
		// the tool's normal error envelope and never reaches
		// createVitest — this must happen before any Vitest/coverage
		// setup so a mismatched root can't leak into a real run.
		const projectRootValidation = yield* Effect.promise(() => validateProjectRoot(input.projectRoot, ctx.cwd));
		if (!projectRootValidation.ok) {
			return { kind: "error" as const, message: projectRootValidation.message };
		}
		const resolvedRoot = projectRootValidation.root;

		// Issue #275: refuse a same-repository, different-worktree caller
		// (hook-injected `_callerCwd`). Indeterminate or absent means "cannot
		// tell" and proceeds.
		const callerCheck = yield* Effect.promise(() => checkCallerWorktree(input._callerCwd, resolvedRoot));
		if (!callerCheck.ok) {
			return { kind: "error" as const, message: callerCheck.message };
		}

		// Vitest 5 probes only `root` for a config file. The default
		// (unsupplied `projectRoot`) path is already anchored at a
		// directory that holds one, so it needs nothing. An EXPLICIT
		// `projectRoot` keeps its verbatim `root` and gets the config
		// passed alongside it — without this a package-subtree root
		// runs on pure defaults, never loads AgentPlugin, writes no DB
		// rows, and still returns `kind: "ok"`.
		let anchoredConfig: string | undefined;
		if (input.projectRoot !== undefined) {
			const found = yield* onNodePlatform(resolveAnchoredConfigFile(resolvedRoot));
			if (found === null) {
				return {
					kind: "error" as const,
					message: `No vitest.config.* or vite.config.* was found at or above projectRoot "${resolvedRoot}" within the repository. Vitest 5 does not search ancestor directories, so this run would collect no tests and load no plugins. Pass a projectRoot that contains a Vitest config, or omit projectRoot to anchor automatically.`,
				};
			}
			anchoredConfig = found;
		}

		// Issue #461: the entry is re-resolved on EVERY call (never cached from
		// boot), so an install that merely moved vitest's store directory heals
		// itself — the next call resolves the new path and `import()` loads it
		// fresh. When the resolution still points at a path that is gone (Node's
		// resolver caches package lookups for the life of the process), fail
		// fast with the typed `stale-install` reason and the restart remedy (see
		// `staleInstallMessage`), before any env write or temp-dir side effect.
		// A resolved path that differs from a previously loaded one is NOT
		// refused: the server legitimately drives different vitest copies for
		// different roots (a sibling worktree with its own lockfile, issue #512),
		// and each `createVitest` instance holds its own copy's state while its
		// forked workers resolve vitest from disk themselves. The identity hazard
		// from issue #303 is between the server and the PROJECT's copy for one
		// root, which anchoring at `resolvedRoot` already settles.
		const vitestEntry = vitestLoader.resolveEntry(resolvedRoot);
		const staleMessage = staleInstallMessage(vitestEntry);
		if (staleMessage !== null) {
			return { kind: "error" as const, reason: "stale-install" as const, message: staleMessage };
		}

		// Propagate the active SessionContext into process.env so the
		// in-process Vitest reporter (which reads VITEST_AGENT_*
		// directly from the environment at startup) attributes this run
		// to the active agent; the lane's scope restores the previous
		// values when the run ends, so a later call without a context
		// never inherits this one's attribution.
		//
		// Source priority (most authoritative first):
		//   1. `input._sessionContext` — injected by the
		//      `pre-tool-use-mcp-run-tests.sh` hook on every call;
		//      always reflects the SessionStart-written exports.
		//   2. `ctx.sessionContext.get()` — boot-time fallback (will be
		//      `null` in practice because Claude Code does not
		//      auto-source CLAUDE_ENV_FILE into MCP children).
		const recovered = input._sessionContext ?? ctx.sessionContext.get();
		if (recovered !== null) {
			yield* ProcessScope.env(process.env, {
				VITEST_AGENT_CHAT_ID: recovered.chatId,
				VITEST_AGENT_CONVERSATION_ID: recovered.conversationId,
				VITEST_AGENT_AGENT_ID: recovered.mainAgentId,
			});
		}

		return yield* runVitest({ input, ctx, scope, resolvedRoot, anchoredConfig, vitestEntry }).pipe(
			Effect.catchTags({
				RunStepFailure: (e) => Effect.succeed({ kind: "error" as const, message: errorMessage(e.cause) }),
				ProcessScopeError: (e) => Effect.succeed({ kind: "error" as const, message: errorMessage(e.cause) }),
			}),
		);
	});

/**
 * Handler for {@link runTestsTool}. The body runs in the one-permit
 * `Exclusive` lane: it assigns the active attribution UUIDs into
 * `process.env.VITEST_AGENT_*`, enters the run's root, and then awaits
 * `createVitest` / `vitest.start`, which spawns the worker pool that
 * snapshots env and cwd at spawn time — two interleaved calls would race,
 * attributing one call's results to the other's agent. A client cancel
 * drops the response; the next call waits for the real run to end.
 *
 * @public
 */
export const handleRunTests = (
	input: RunTestsInputType,
): Effect.Effect<RunTestsResultType, never, McpSession | DataReader | DataStore> =>
	Effect.gen(function* () {
		const session = yield* McpSession;
		const ctx: RunTestsContext = {
			cwd: session.cwd,
			currentSessionId: session.currentSessionId,
			sessionContext: session.sessionContext,
		};
		const timeoutSeconds = input.timeout ?? 120;
		// The coverage temp dir uses the ambient `FileSystem` when one is
		// provided (a test's faulted volume), else Node's.
		const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
		const platformFs = Option.match(fs, {
			onNone: () => NodeFileSystem.layer,
			onSome: (service) => Layer.succeed(FileSystem.FileSystem, service),
		});
		return yield* runTestsLane
			.run(runTestsBody(input, ctx), { timeout: timeoutSeconds * 1000 + LANE_ALLOWANCE_MS })
			.pipe(
				// The whole body overran its lane allowance (a hung config load
				// or teardown): reported as the run's timeout.
				Effect.catchTag("ExclusiveTimeout", () => Effect.succeed({ kind: "timeout" as const, timeoutSeconds })),
				Effect.provide(platformFs),
			);
	});

/**
 * The Effect-native `run_tests` tool.
 *
 * @public
 */
export const runTestsTool = Tool.make("run_tests", {
	description:
		'Use to run Vitest tests, with optional file, project, and tag filters. structuredContent carries the typed AgentReport plus per-test classifications (discriminate on `kind`: ok, timeout, error, no-match). Unknown parameters are rejected — accepted keys are files, project, tags, passWithNoTests, timeout, projectRoot. When projectRoot is omitted, the server anchors the Vitest root at the directory of the vitest (or vite) config Vitest would load anyway, walking up from its boot dir and stopping at the git root — so a server booted inside a package subtree still resolves the root config\'s relative globalSetup/setupFiles correctly. projectRoot overrides that for this call and is used verbatim, but only after validation: it must be an existing directory belonging to the same git repository as ctx.cwd (checked via `git rev-parse --path-format=absolute --git-common-dir`, which needs git 2.31 or newer and is identical across a repo and all its worktrees, including a sibling worktree checked out from the same repo). A path in a different repository, or a non-existent path, is rejected with `{ kind: "error" }` naming both paths — never a silent fallback to ctx.cwd. The resolved root actually used is always echoed back on success. When the plugin hook supplies the caller working directory (the hook-injected _callerCwd), a call from a different working tree of the same repository than the resolved root is refused with `{ kind: "error" }` naming both trees; pass projectRoot (your own worktree path) to run there. An absent or indeterminate caller directory never refuses. An error result with `reason: "stale-install"` means the vitest install was replaced under this long-lived server (the lockfile was regenerated) and the resolved vitest/node entry is gone; restart the MCP server (/mcp in Claude Code) rather than retrying. The legacy format=json arg is dropped — structuredContent supersedes it.',
	parameters: RunTestsInput,
	success: RunTestsResult,
	dependencies: [McpSession, DataReader, DataStore],
})
	.annotate(Tool.Title, "Run tests")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, false);

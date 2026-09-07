/**
 * Lazily-created writer over Vitest 5's `createReport` scope directory.
 *
 * `vitest.createReport(scope)` mkdirs `<config.root>/.vitest/<scope>`
 * eagerly and synchronously at call time, so the handle is created on
 * the first write rather than at reporter construction — a run that
 * emits no report-targeted output leaves no directory behind.
 *
 * `clean()` is never called: it would wipe a prior shard's output, and
 * it is a no-op under `--merge-reports` anyway.
 *
 * @internal
 */

interface ReportHandle {
	readonly writeFile: (filename: string, content: string) => Promise<void>;
}

/** @internal */
export interface ReportWriter {
	/** Queue one report file for writing. Creates the scope dir on first call. */
	readonly write: (filename: string, content: string) => void;
	/** Await every queued write. Never rejects. */
	readonly flush: () => Promise<void>;
}

const VITEST_5_REQUIRED =
	"vitest-agent: writing report files requires Vitest 5's `createReport` API. Upgrade vitest to ^5.0.0, or set `AgentPlugin({ report: false })`.";

/**
 * Narrow a Vitest instance to one carrying `createReport`, throwing the
 * upgrade message when it does not.
 *
 * Called eagerly from `onInit` so an unsupported Vitest fails before any
 * rendering happens, rather than mid-way through a routing loop. It only
 * reads the property — `createReport` itself stays uncalled, preserving
 * the lazy directory creation.
 *
 * @internal
 */
export const assertReportCapable = (vitest: unknown): void => {
	const create = (vitest as { createReport?: unknown } | null)?.createReport;
	if (typeof create !== "function") throw new Error(VITEST_5_REQUIRED);
};

/**
 * Vitest's `Report.writeFile` resolves `filename` against the scope
 * directory with no `mkdir` and no containment check, so a nested path
 * rejects at write time and a `..` segment escapes the directory
 * entirely. Reject both here, where the message can name the culprit.
 */
const assertFlatFilename = (filename: string): void => {
	if (filename.includes("/") || filename.includes("\\") || filename === ".." || filename === ".") {
		throw new Error(
			`vitest-agent: report filename ${filename} must be a flat name — Vitest writes it directly into the report scope directory and creates no intermediate directories.`,
		);
	}
};

/** @internal */
export const createReportWriter = (vitest: unknown, scope: string): ReportWriter => {
	let handle: ReportHandle | null = null;
	const pending: Array<Promise<void>> = [];

	const resolveHandle = (): ReportHandle => {
		if (handle !== null) return handle;
		const create = (vitest as { createReport?: (scope: string) => ReportHandle } | null)?.createReport;
		if (typeof create !== "function") throw new Error(VITEST_5_REQUIRED);
		handle = create.call(vitest, scope);
		return handle;
	};

	return {
		write: (filename, content) => {
			assertFlatFilename(filename);
			const report = resolveHandle();
			// Report files are supplemental output — a failed write must not
			// fail the test run. Failures surface on stderr at flush time.
			pending.push(
				report.writeFile(filename, content).catch((err: unknown) => {
					process.stderr.write(`vitest-agent: report file ${filename} not written: ${String(err)}\n`);
				}),
			);
		},
		flush: async () => {
			await Promise.all(pending);
			pending.length = 0;
		},
	};
};

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

/** @internal */
export const createReportWriter = (vitest: unknown, scope: string): ReportWriter => {
	let handle: ReportHandle | null = null;
	const pending: Array<Promise<void>> = [];

	const resolveHandle = (): ReportHandle => {
		if (handle !== null) return handle;
		const create = (vitest as { createReport?: (scope: string) => ReportHandle } | null)?.createReport;
		if (typeof create !== "function") {
			throw new Error(
				"vitest-agent: writing report files requires Vitest 5's `createReport` API. Upgrade vitest to ^5.0.0, or set `AgentPlugin({ report: false })`.",
			);
		}
		handle = create.call(vitest, scope);
		return handle;
	};

	return {
		write: (filename, content) => {
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

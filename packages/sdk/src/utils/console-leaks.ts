import type { ConsoleLeakFile, ConsoleLeaks } from "../schemas/ConsoleLeaks.js";

const SAMPLE_MAX_CHARS = 160;
const MAX_FILES = 25;
const MAX_TESTS_PER_FILE = 10;

/**
 * A single captured stray console write, attributed to a file (and a test
 * when the write happened inside one). Fed to buildConsoleLeaks.
 * @public
 */
export interface ConsoleLeakEntry {
	readonly file: string;
	readonly test?: string;
	readonly type: "stdout" | "stderr";
	readonly content: string;
	/**
	 * True when this write happened inside a test (or a suite/module) that did
	 * not end in a passing state. Assertion-failure logging that routes through
	 * `console.*` (common with logger-backed assertion libraries) sets this so
	 * buildConsoleLeaks can keep it out of the actionable leak signal.
	 */
	readonly failed?: boolean;
}

interface FileAcc {
	stdout: number;
	stderr: number;
	tests: Set<string>;
	sample?: string;
}

function truncateSample(content: string): string {
	const firstLine = content.split("\n", 1)[0] ?? "";
	const trimmed = firstLine.trim();
	return trimmed.length > SAMPLE_MAX_CHARS ? `${trimmed.slice(0, SAMPLE_MAX_CHARS)}…` : trimmed;
}

/**
 * Aggregate raw console-leak entries into a ConsoleLeaks signal:
 * bucket by file, split stdout/stderr, collect attributable test names,
 * capture one truncated sample per file, sort by total writes descending,
 * and cap the file list. Entries logged inside a failing test (`failed:
 * true`) are excluded from `total`/`byFile` — the actionable leak signal —
 * and summarized instead in `fromFailingTests` (issue #263: a logger-backed
 * assertion failure otherwise makes every red run look like a leak). Returns
 * `undefined` only when there is no output at all, non-failing or failing.
 * @public
 */
export function buildConsoleLeaks(entries: ReadonlyArray<ConsoleLeakEntry>): ConsoleLeaks | undefined {
	if (entries.length === 0) return undefined;

	const nonFailing = entries.filter((e) => e.failed !== true);
	const failing = entries.filter((e) => e.failed === true);

	const fromFailingTests =
		failing.length > 0 ? { total: failing.length, files: new Set(failing.map((e) => e.file)).size } : undefined;

	if (nonFailing.length === 0) {
		return { total: 0, byFile: [], ...(fromFailingTests !== undefined ? { fromFailingTests } : {}) };
	}

	const byFile = new Map<string, FileAcc>();
	for (const e of nonFailing) {
		let acc = byFile.get(e.file);
		if (acc === undefined) {
			acc = { stdout: 0, stderr: 0, tests: new Set() };
			byFile.set(e.file, acc);
		}
		if (e.type === "stdout") acc.stdout++;
		else acc.stderr++;
		if (e.test !== undefined && e.test !== "") acc.tests.add(e.test);
		// Capture the first NON-EMPTY sample. A first write whose first line is
		// whitespace-only truncates to "", so we leave sample unset and let a
		// later content-bearing write fill it rather than locking in a blank.
		if (acc.sample === undefined) {
			const candidate = truncateSample(e.content);
			if (candidate !== "") acc.sample = candidate;
		}
	}

	const files: ConsoleLeakFile[] = [];
	for (const [file, acc] of byFile) {
		files.push({
			file,
			stdout: acc.stdout,
			stderr: acc.stderr,
			...(acc.tests.size > 0 ? { tests: [...acc.tests].slice(0, MAX_TESTS_PER_FILE) } : {}),
			...(acc.sample !== undefined ? { sample: acc.sample } : {}),
		});
	}
	files.sort((a, b) => b.stdout + b.stderr - (a.stdout + a.stderr));

	const truncated = files.length > MAX_FILES;
	return {
		total: nonFailing.length,
		byFile: truncated ? files.slice(0, MAX_FILES) : files,
		...(truncated ? { truncated: true } : {}),
		...(fromFailingTests !== undefined ? { fromFailingTests } : {}),
	};
}

/**
 * Structural subset of a Vitest runner task (File / Suite / Test) carrying
 * captured console output. Modeled locally so this util needs no `vitest`
 * dependency. `logs` is attached to tasks by Vitest's console interception
 * regardless of which reporter is active, which is why the walk survives
 * reporter stripping in agent mode.
 * @public
 */
export interface ConsoleLeakTask {
	readonly type?: string;
	readonly name?: string;
	readonly fullTestName?: string;
	readonly logs?: ReadonlyArray<{ readonly type: "stdout" | "stderr"; readonly content: string }>;
	readonly tasks?: ReadonlyArray<ConsoleLeakTask>;
	/**
	 * Vitest's own `TaskResult`, structurally narrowed to the one field this
	 * util reads. `state` is `"pass" | "fail"` once the task has finished
	 * running (still a `RunMode` value like `"run"`/`"skip"` beforehand).
	 */
	readonly result?: { readonly state?: string };
}

/**
 * Walk a Vitest `File[]` task tree (from `vitest.state.getFiles()`) into flat
 * {@link ConsoleLeakEntry} values. Each task `log` becomes one entry attributed
 * to its enclosing file and, when the log sits on a test task, that test's name.
 * An entry is marked `failed: true` when it was logged inside a test whose own
 * `result.state` is `"fail"`, or — for output with no owning test — when the
 * enclosing file itself failed (e.g. a collection/load error).
 * @public
 */
export function collectConsoleLeakEntries(files: ReadonlyArray<ConsoleLeakTask>): ConsoleLeakEntry[] {
	const entries: ConsoleLeakEntry[] = [];
	const visit = (
		task: ConsoleLeakTask,
		file: string,
		test: string | undefined,
		testFailed: boolean,
		fileFailed: boolean,
	): void => {
		const isTest = task.type === "test";
		const currentTest = isTest ? (task.fullTestName ?? task.name ?? test) : test;
		const currentTestFailed = isTest ? task.result?.state === "fail" : testFailed;
		for (const log of task.logs ?? []) {
			const failed = currentTest !== undefined ? currentTestFailed : fileFailed;
			entries.push({
				file,
				...(currentTest !== undefined ? { test: currentTest } : {}),
				type: log.type,
				content: log.content,
				...(failed ? { failed: true } : {}),
			});
		}
		for (const child of task.tasks ?? []) visit(child, file, currentTest, currentTestFailed, fileFailed);
	};
	for (const file of files) {
		const fileFailed = file.result?.state === "fail";
		visit(file, file.name ?? "(unknown)", undefined, false, fileFailed);
	}
	return entries;
}

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
 * and cap the file list. Returns `undefined` when there are no entries so a
 * clean run attaches nothing.
 * @public
 */
export function buildConsoleLeaks(entries: ReadonlyArray<ConsoleLeakEntry>): ConsoleLeaks | undefined {
	if (entries.length === 0) return undefined;

	const byFile = new Map<string, FileAcc>();
	for (const e of entries) {
		let acc = byFile.get(e.file);
		if (acc === undefined) {
			acc = { stdout: 0, stderr: 0, tests: new Set() };
			byFile.set(e.file, acc);
		}
		if (e.type === "stdout") acc.stdout++;
		else acc.stderr++;
		if (e.test !== undefined && e.test !== "") acc.tests.add(e.test);
		if (acc.sample === undefined) acc.sample = truncateSample(e.content);
	}

	const files: ConsoleLeakFile[] = [];
	for (const [file, acc] of byFile) {
		files.push({
			file,
			stdout: acc.stdout,
			stderr: acc.stderr,
			...(acc.tests.size > 0 ? { tests: [...acc.tests].slice(0, MAX_TESTS_PER_FILE) } : {}),
			...(acc.sample !== undefined && acc.sample !== "" ? { sample: acc.sample } : {}),
		});
	}
	files.sort((a, b) => b.stdout + b.stderr - (a.stdout + a.stderr));

	const truncated = files.length > MAX_FILES;
	return {
		total: entries.length,
		byFile: truncated ? files.slice(0, MAX_FILES) : files,
		...(truncated ? { truncated: true } : {}),
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
}

/**
 * Walk a Vitest `File[]` task tree (from `vitest.state.getFiles()`) into flat
 * {@link ConsoleLeakEntry} values. Each task `log` becomes one entry attributed
 * to its enclosing file and, when the log sits on a test task, that test's name.
 * @public
 */
export function collectConsoleLeakEntries(files: ReadonlyArray<ConsoleLeakTask>): ConsoleLeakEntry[] {
	const entries: ConsoleLeakEntry[] = [];
	const visit = (task: ConsoleLeakTask, file: string, test: string | undefined): void => {
		const currentTest = task.type === "test" ? (task.fullTestName ?? task.name ?? test) : test;
		for (const log of task.logs ?? []) {
			entries.push({
				file,
				...(currentTest !== undefined ? { test: currentTest } : {}),
				type: log.type,
				content: log.content,
			});
		}
		for (const child of task.tasks ?? []) visit(child, file, currentTest);
	};
	for (const file of files) {
		visit(file, file.name ?? "(unknown)", undefined);
	}
	return entries;
}

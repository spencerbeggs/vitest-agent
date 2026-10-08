import { Schema } from "effect";

/**
 * One line of stray output, kept as a sample: the stream it was written to,
 * and its text with escapes stripped, cut to a sane length.
 * @public
 */
export const StrayOutputSample = Schema.Struct({
	stream: Schema.Literals(["stdout", "stderr"]),
	text: Schema.String,
}).annotate({ identifier: "StrayOutputSample" });
/** @public */
export type StrayOutputSample = typeof StrayOutputSample.Type;

/**
 * Output a test run wrote straight to the terminal, past Vitest's console
 * capture: bytes a worker process (or a child process it spawned with
 * inherited stdio, such as `execFileSync("git", ...)`) wrote to its own
 * stdout or stderr, which Vitest pipes through to the main process
 * untouched. Distinct from `consoleLeaks`, which counts `console.*` calls
 * Vitest did capture.
 *
 * A run-level signal: the bytes arrive on one stream shared by every project,
 * so nothing attributes them to a project, file or test. Every project report
 * of a run carries the same value. Counts are of non-blank lines; `bytes`
 * counts everything recorded. `samples` holds the first few lines. Omitted
 * when the run wrote nothing stray (and whenever the plugin does not own the
 * console: `passthrough` mode records nothing).
 * @public
 */
export const StrayOutput = Schema.Struct({
	total: Schema.Number,
	stdout: Schema.Number,
	stderr: Schema.Number,
	bytes: Schema.Number,
	samples: Schema.Array(StrayOutputSample),
}).annotate({ identifier: "StrayOutput" });
/** @public */
export type StrayOutput = typeof StrayOutput.Type;

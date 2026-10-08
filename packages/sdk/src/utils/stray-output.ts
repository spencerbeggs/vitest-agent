import type { StrayOutput, StrayOutputSample } from "../schemas/StrayOutput.js";

/**
 * A stream stray output was written to.
 * @public
 */
export type StrayOutputStream = "stdout" | "stderr";

/**
 * Records stray output for one run at a time: counts its non-blank lines per
 * stream and its bytes, and keeps the first few lines as samples. Memory is
 * bounded whatever is written: only the samples and one partial line per
 * stream (itself cut to the sample length) are held.
 * @public
 */
export interface StrayOutputRecorder {
	/** Record text written to `stream`. A write made only of escape sequences is ignored. */
	readonly write: (stream: StrayOutputStream, text: string) => void;
	/** What the run has written so far, a trailing partial line included; `undefined` when nothing. */
	readonly snapshot: () => StrayOutput | undefined;
	/** Forget everything: a new run starts. */
	readonly reset: () => void;
}

/**
 * Options for {@link makeStrayOutputRecorder}.
 * @public
 */
export interface StrayOutputRecorderOptions {
	/** How many lines to keep as samples. @defaultValue 5 */
	readonly maxSamples?: number;
	/** How many characters of a sample to keep before cutting it with `…`. @defaultValue 160 */
	readonly maxSampleChars?: number;
}

// CSI (`ESC [ … final`), OSC (`ESC ] … BEL` or `ESC ] … ESC \`), and the
// two-byte escapes (`ESC c` reset included).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches terminal escape sequences on purpose
const ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_]|c)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips stray control characters from a sample
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * True when `text` is nothing but terminal escape sequences: the cursor
 * hide/show, clear-screen and erase-scrollback writes Vitest's own `Logger`
 * makes straight to its output stream. Empty text is not escape-only.
 * @public
 */
export const isEscapeOnly = (text: string): boolean => text.length > 0 && text.replace(ESCAPE, "").length === 0;

const encoder = new TextEncoder();

interface Pending {
	text: string;
	cut: boolean;
}

/**
 * Make a {@link StrayOutputRecorder}.
 * @public
 */
export const makeStrayOutputRecorder = (options: StrayOutputRecorderOptions = {}): StrayOutputRecorder => {
	const maxSamples = options.maxSamples ?? 5;
	const maxChars = options.maxSampleChars ?? 160;
	let counts = { stdout: 0, stderr: 0 };
	let bytes = 0;
	let samples: StrayOutputSample[] = [];
	let pending: Record<StrayOutputStream, Pending> = {
		stdout: { text: "", cut: false },
		stderr: { text: "", cut: false },
	};

	const clean = (line: string): string => line.replace(ESCAPE, "").replace(CONTROL, "").trim();

	const sampleOf = (line: Pending): string => {
		const text = clean(line.text);
		return line.cut || text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
	};

	// The line counted, and sampled when there is room; a blank line is not a line.
	const finish = (
		stream: StrayOutputStream,
		line: Pending,
		into: { stdout: number; stderr: number },
		out: StrayOutputSample[],
	) => {
		if (clean(line.text) === "") return;
		into[stream]++;
		if (out.length < maxSamples) out.push({ stream, text: sampleOf(line) });
	};

	// Append to a partial line, holding at most what a sample can show (plus
	// slack for escapes stripped later) so a line that never ends stays small.
	const append = (line: Pending, text: string): void => {
		const room = maxChars * 4 - line.text.length;
		if (text.length <= room) line.text += text;
		else {
			line.text += text.slice(0, Math.max(0, room));
			line.cut = true;
		}
	};

	return {
		write: (stream, text) => {
			if (text.length === 0 || isEscapeOnly(text)) return;
			bytes += encoder.encode(text).length;
			const parts = text.split("\n");
			const line = pending[stream];
			append(line, parts[0] ?? "");
			for (let i = 1; i < parts.length; i++) {
				finish(stream, line, counts, samples);
				line.text = "";
				line.cut = false;
				append(line, parts[i] ?? "");
			}
		},
		snapshot: () => {
			const totals = { ...counts };
			const out = [...samples];
			finish("stdout", pending.stdout, totals, out);
			finish("stderr", pending.stderr, totals, out);
			const total = totals.stdout + totals.stderr;
			if (total === 0) return undefined;
			return { total, stdout: totals.stdout, stderr: totals.stderr, bytes, samples: out };
		},
		reset: () => {
			counts = { stdout: 0, stderr: 0 };
			bytes = 0;
			samples = [];
			pending = { stdout: { text: "", cut: false }, stderr: { text: "", cut: false } };
		},
	};
};

/**
 * The key a stray-output capture publishes its {@link StrayOutputSource}
 * under, on the Vitest `Logger` whose streams it wraps. `Symbol.for`, so a
 * plugin and an MCP server that load different copies of this package still
 * meet on it.
 * @public
 */
export const STRAY_OUTPUT_SOURCE: unique symbol = Symbol.for("vitest-agent/stray-output");

/**
 * What a stray-output capture publishes for a reader that did not install it.
 * @public
 */
export interface StrayOutputSource {
	/** The current run's stray output, or `undefined` when it wrote none. */
	readonly snapshot: () => StrayOutput | undefined;
}

/**
 * Read the current run's stray output from a Vitest `Logger` a capture was
 * installed on. `undefined` when none was installed, or the run wrote nothing.
 * @public
 */
export const readStrayOutput = (logger: unknown): StrayOutput | undefined => {
	if (logger === null || typeof logger !== "object") return undefined;
	const source = (logger as { [STRAY_OUTPUT_SOURCE]?: unknown })[STRAY_OUTPUT_SOURCE];
	if (source === null || typeof source !== "object") return undefined;
	const snapshot = (source as { snapshot?: unknown }).snapshot;
	return typeof snapshot === "function" ? (snapshot as StrayOutputSource["snapshot"])() : undefined;
};

const MAX_NOTE_SAMPLES = 3;

/**
 * The note a renderer prints for a run's stray output: one line naming the
 * count, the streams, the usual cause and the fix, then up to three sample
 * lines and how many it left out.
 * @public
 */
export const formatStrayOutputNote = (stray: StrayOutput): ReadonlyArray<string> => {
	const streams = stray.stdout > 0 && stray.stderr > 0 ? "stdout and stderr" : stray.stdout > 0 ? "stdout" : "stderr";
	const lines = [
		`Stray output: tests wrote ${stray.total} ${stray.total === 1 ? "line" : "lines"} directly to ${streams}, bypassing Vitest's console capture. A child process with inherited stdio is the usual cause; pass \`stdio: "pipe"\`.`,
	];
	const shown = stray.samples.slice(0, MAX_NOTE_SAMPLES);
	for (const sample of shown) lines.push(`  ${sample.stream}: ${sample.text}`);
	const more = stray.total - shown.length;
	if (more > 0 && shown.length > 0) lines.push(`  (+${more} more)`);
	return lines;
};

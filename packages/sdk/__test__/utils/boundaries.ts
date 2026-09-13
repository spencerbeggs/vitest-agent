import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The three quote characters a string or template literal can open with. */
const isQuote = (char: string): boolean => char === '"' || char === "'" || char === "`";

/** True for an identifier character (letters, digits, `_`, `$`). */
const isWordChar = (char: string | undefined): boolean => char !== undefined && /[A-Za-z0-9_$]/.test(char);

/**
 * Punctuation after which a bare `/` can only start a regex literal, never
 * mark division — e.g. `foo(/re/)`, `x = /re/`, `[/re/]`.
 */
const REGEX_PRECEDING_PUNCTUATION = new Set([
	"(",
	",",
	"=",
	":",
	"[",
	"!",
	"&",
	"|",
	"?",
	"{",
	"}",
	";",
	"+",
	"-",
	"*",
	"%",
	"<",
	">",
	"~",
	"^",
]);

/** Keywords after which a bare `/` starts a regex literal rather than division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
	"return",
	"typeof",
	"case",
	"do",
	"else",
	"in",
	"of",
	"instanceof",
	"new",
	"delete",
	"void",
	"throw",
	"yield",
	"await",
]);

/**
 * The last non-whitespace character emitted into `text` so far, plus (when
 * that character is part of an identifier) the whole trailing word — used to
 * decide whether a following `/` opens a regex literal or means division.
 */
const lastSignificantToken = (text: string): { char?: string; word?: string } => {
	let index = text.length - 1;
	while (index >= 0 && /\s/.test(text[index])) index--;
	if (index < 0) return {};
	const char = text[index];
	if (!isWordChar(char)) return { char };
	const end = index;
	let start = index;
	while (start >= 0 && isWordChar(text[start])) start--;
	return { char, word: text.slice(start + 1, end + 1) };
};

/**
 * True when a `/` appearing right after everything emitted into `resultSoFar`
 * would open a regex literal rather than mean division or a closing bracket —
 * start of file, after regex-starting punctuation, or after a regex-starting
 * keyword (`return`, `typeof`, …). A `/` following an identifier or a number
 * that is not one of those keywords is division.
 */
const canPrecedeRegex = (resultSoFar: string): boolean => {
	const { char, word } = lastSignificantToken(resultSoFar);
	if (char === undefined) return true;
	if (word !== undefined) return REGEX_PRECEDING_KEYWORDS.has(word);
	return REGEX_PRECEDING_PUNCTUATION.has(char);
};

/**
 * Removes every `//` line comment and `/* … *‍/` block comment (TSDoc
 * included) from `contents`, so prose that happens to use a bare word like
 * "process" can never trip a source-text scan looking for real code —
 * without also treating a `//` or `/*` that appears INSIDE a string,
 * template literal (`"http://x"`, `` `/* not a comment *‍/` ``), or regex
 * literal (`/[^/*]/`, `/https?:\/\//`) as a comment start. Walks the text
 * once as a small state machine, tracking whether it is currently inside a
 * `"`, `'`, or backtick literal, or a `/…/` regex literal (honouring a
 * backslash escape at the simple level, and a `[…]` character class inside a
 * regex in which `/` does not terminate the literal — enough for real
 * source, not a full parser) and only recognising comment markers outside
 * one.
 *
 * Regex-literal detection is a heuristic, not a parser: a bare `/` opens a
 * regex when the previous non-whitespace token is start-of-file, one of a
 * fixed set of punctuation (`(`, `,`, `=`, `:`, `[`, …), or one of a fixed
 * set of keywords (`return`, `typeof`, `case`, …); otherwise it is treated as
 * division and left alone. This matches real-world source well enough to
 * keep a division expression from swallowing an adjacent block comment.
 *
 * A stripped block comment is replaced with a single space rather than
 * deleted outright, so two tokens either side of it (`foo/* c *‍/bar`)
 * never fuse into one word.
 */
export const stripComments = (contents: string): string => {
	let result = "";
	let index = 0;
	const { length } = contents;
	while (index < length) {
		const char = contents[index];
		if (isQuote(char)) {
			const quote = char;
			result += char;
			index++;
			while (index < length) {
				const inner = contents[index];
				if (inner === "\\") {
					result += inner;
					index++;
					if (index < length) {
						result += contents[index];
						index++;
					}
					continue;
				}
				result += inner;
				index++;
				if (inner === quote) break;
			}
			continue;
		}
		const two = contents.slice(index, index + 2);
		if (char === "/" && two !== "//" && two !== "/*" && canPrecedeRegex(result)) {
			result += char;
			index++;
			let inClass = false;
			while (index < length) {
				const inner = contents[index];
				if (inner === "\\") {
					result += inner;
					index++;
					if (index < length) {
						result += contents[index];
						index++;
					}
					continue;
				}
				if (inner === "\n") break;
				if (inner === "[") inClass = true;
				else if (inner === "]") inClass = false;
				result += inner;
				index++;
				if (inner === "/" && !inClass) break;
			}
			while (index < length && /[A-Za-z]/.test(contents[index])) {
				result += contents[index];
				index++;
			}
			continue;
		}
		if (two === "//") {
			while (index < length && contents[index] !== "\n") index++;
			continue;
		}
		if (two === "/*") {
			index += 2;
			while (index < length && contents.slice(index, index + 2) !== "*/") index++;
			index += 2;
			result += " ";
			continue;
		}
		result += char;
		index++;
	}
	return result;
};

/** The literal, build-time-substituted token exempt from the `process` boundary check. */
export const VERSION_TOKEN = "process.env.__PACKAGE_VERSION__";

/**
 * True when `source` references the global `process` object anywhere outside
 * comments and outside the single exempted `VERSION_TOKEN` literal. A string
 * literal containing `process.` is treated conservatively as a reference
 * (comments are stripped, but string contents are not), matching the
 * boundary check's intent: nothing under `src/` should read `process` at
 * runtime, including through a string a linter can't see into.
 */
export const referencesProcess = (source: string): boolean =>
	/\bprocess\s*\./.test(stripComments(source).split(VERSION_TOKEN).join(""));

/**
 * Every module specifier imported or dynamically `import()`-ed by `source`,
 * with comments stripped first. Covers `import … from "x"`, `export … from
 * "x"`, and `import("x")` / `await import("x")` forms, including
 * `import type { X } from "x"`.
 */
export const importSpecifiers = (source: string): string[] =>
	[...stripComments(source).matchAll(/from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
		(m) => (m[1] ?? m[2]) as string,
	);

/**
 * Every module specifier imported by `source` that matches `predicate`,
 * comments stripped first.
 */
export const importsMatching = (source: string, predicate: (specifier: string) => boolean): string[] =>
	importSpecifiers(source).filter(predicate);

/** Directory names never descended into while walking for source files. */
const EXCLUDED_DIRS = new Set(["node_modules", ".git"]);

/**
 * Recursively collects every `.ts`/`.tsx` file under `dir` (test files
 * excluded), skipping `node_modules` and `.git` directories anywhere in the
 * tree — `packages/sdk/src/node_modules` is a real local-dev artifact, not
 * source to scan.
 */
export const walkTs = (dir: string): string[] => {
	const results: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (EXCLUDED_DIRS.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkTs(full));
			continue;
		}
		if (
			entry.isFile() &&
			(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
			!entry.name.endsWith(".test.ts")
		) {
			results.push(full);
		}
	}
	return results;
};

/**
 * Cheaply strips `//` line comments and `/* *\/` block comments from `source`.
 *
 * Not a full lexer — a marker string that happens to sit inside a string
 * literal containing comment-like syntax could slip through uncaught. That
 * false positive is acceptable: {@link detectNonDefaultDiscoverStrategy} is
 * only ever used to decide whether to fail open, and failing open is the
 * safe direction.
 */
function stripComments(source: string): string {
	// A single forward pass, no regex: CodeQL (js/polynomial-redos) flags
	// even the unrolled block-comment regex on inputs with many `)/**`
	// repetitions, and the scanner is trivially linear in the input length.
	let out = "";
	let i = 0;
	const n = source.length;
	while (i < n) {
		const c = source[i];
		const next = source[i + 1];
		if (c === "/" && next === "*") {
			// Block comment: skip to the closing `*/`, or to the end of the
			// input when it is unterminated.
			const close = source.indexOf("*/", i + 2);
			i = close === -1 ? n : close + 2;
			continue;
		}
		if (c === "/" && next === "/") {
			// Line comment: skip to (not past) the newline.
			const eol = source.indexOf("\n", i + 2);
			i = eol === -1 ? n : eol;
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

const DISCOVER_STRATEGY_OPTION_RE = /\bdiscoverStrategy\s*:/;
const ADD_PROJECT_MARKER = ".addProject(";
const EXTENDS_DEFAULT_STRATEGY_RE = /\bextends\s+DefaultDiscoverStrategy\b/;
const IMPLEMENTS_STRATEGY_RE = /\bimplements\s+DiscoverStrategy\b/;

/**
 * Lexically detects whether a Vitest/Vite config source text appears to
 * configure a non-default `DiscoverStrategy` — a custom `discoverStrategy`
 * option (including `discoverStrategy: false`), an `AgentPlugin.discover()`
 * `.addProject(...)` chain, or a class extending `DefaultDiscoverStrategy` /
 * implementing `DiscoverStrategy`.
 *
 * Pure and comment-tolerant (best-effort): a marker mentioned only inside a
 * comment may still register as a false positive if it isn't caught by the
 * comment-stripping pass. That is intentional — this function only ever
 * decides whether to fail open, so a false positive is harmless while a
 * false negative would produce a confidently wrong deny.
 * @public
 */
export function detectNonDefaultDiscoverStrategy(source: string): boolean {
	const stripped = stripComments(source);
	return (
		DISCOVER_STRATEGY_OPTION_RE.test(stripped) ||
		stripped.includes(ADD_PROJECT_MARKER) ||
		EXTENDS_DEFAULT_STRATEGY_RE.test(stripped) ||
		IMPLEMENTS_STRATEGY_RE.test(stripped)
	);
}

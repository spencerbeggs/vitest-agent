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
	// Unrolled block-comment matcher: linear in the input length, unlike the
	// lazy `[\s\S]*?` form, which restarts its scan from every `/*` on an
	// unterminated comment and goes quadratic (CodeQL js/polynomial-redos).
	return source.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "").replace(/\/\/.*$/gm, "");
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

import { formatTerminal } from "../utils/format-terminal.js";
import { osc8 } from "../utils/hyperlink.js";
import { joinPosix } from "../utils/posix-path.js";
import type { Formatter, FormatterContext, RenderedOutput } from "./types.js";

/**
 * Wrap test-file paths in failing-test rows with `file://` OSC-8
 * hyperlinks. Only fires when the target is stdout and noColor is
 * unset; MCP responses never reach this formatter so they cannot
 * accidentally pick up escape sequences.
 *
 * Failing-test rows are emitted by `renderFailedTest` in
 * `format-terminal.ts` as
 *
 *   `    ` + ANSI(red, ✗) + ` ` + path + ` > ` + fullName
 *
 * The ✗ is wrapped in ANSI color escapes whenever color is on (which
 * is always when this function runs — `wrapHyperlinks` is gated on
 * `!noColor`). The optional `(?:\x1b\[\d+m)?` groups around `✗` make
 * the pattern tolerant of those escapes; without them the regex
 * silently never matched and the hyperlink feature was a no-op.
 *
 * The captured path is project-relative (the failing-test row goes
 * through `relativePath()` in `format-terminal.ts`). RFC 8089
 * requires an absolute filesystem path inside a `file://` URL —
 * iTerm2 / WezTerm / Kitty / VSCode all silently fail to open
 * relative targets. Resolve the captured value back to absolute
 * against `ctx.cwd` before handing it to `osc8`. The display label
 * stays relative so the rendered output is unchanged.
 * @public
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences around the red cross is the whole point
const FAILED_TEST_ROW = /^( {4}(?:\x1b\[\d+m)?✗(?:\x1b\[\d+m)? )([^ ]+)( > )/gm;

const wrapHyperlinks = (text: string, ctx: FormatterContext): string =>
	text.replace(FAILED_TEST_ROW, (_match, prefix: string, captured: string, suffix: string) => {
		const absolute = captured.startsWith("/") ? captured : joinPosix(ctx.cwd, captured);
		const linked = osc8(`file://${absolute}`, captured, { enabled: !ctx.noColor });
		return `${prefix}${linked}${suffix}`;
	});
/** @public */
export const TerminalFormatter: Formatter = {
	format: "terminal",
	render: (reports, context) => {
		const text = formatTerminal(reports, {
			cwd: context.cwd,
			noColor: context.noColor,
			coverageConsoleLimit: context.coverageConsoleLimit,
			...(context.trendSummary !== undefined ? { trendSummary: context.trendSummary } : {}),
			...(context.mcp !== undefined ? { mcp: context.mcp } : {}),
		});
		if (text === "") return [];
		const enriched = context.noColor ? text : wrapHyperlinks(text, context);
		const out: RenderedOutput = {
			target: "stdout",
			content: enriched,
			contentType: "text/plain",
		};
		return [out];
	},
};

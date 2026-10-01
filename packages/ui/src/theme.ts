/**
 * The one vitest-agent status vocabulary and its bridge to Ink.
 *
 * Every glyph and colour the render paths draw with comes from here:
 * `VitestAgentStatus` is `@effected/cli`'s core vocabulary (success, skip,
 * pending, info, warning, failure) extended with the three statuses a test
 * run adds (timeout, running, queued), and the non-status accents (the
 * classification tag, a zero count, the `stable` trend) are named
 * {@link VitestAgentTokens}. The kit's drift decisions apply by
 * construction: skip is `muted`, a regressing trend is `warning`, a coverage
 * threshold failure is `failure` and a target shortfall is `warning`.
 *
 * Ink takes colour as `<Text>` props, not ANSI, and `CliTheme` answers only
 * painted strings (`paint`) or raw SGR (`sgr`), so {@link inkStyle}
 * resolves a token to a `Style` and maps it onto Ink's props. The token
 * defaults are mirrored in {@link TOKEN_STYLES}; a unit test holds the
 * mirror to the kit's own `CliTheme.sgr` output.
 *
 * @packageDocumentation
 */

import type { CoreStatusName, NamedColor, Style, TokenName } from "@effected/cli";
import { Status, Token } from "@effected/cli";

/**
 * The status vocabulary every vitest-agent render path draws from.
 *
 * @remarks
 * Ranks slot the run statuses into the core ladder: `queued` (25) and
 * `running` (35) sit among the not-yet-decided statuses, and `timeout` (85)
 * is just under `failure` (90), so `Status.worst` over a project's
 * outcomes reads failure, then timeout, then warning.
 *
 * @public
 */
export const VitestAgentStatus: Status<VitestAgentStatusName> = Status.extend({
	timeout: { glyph: "⧖", ascii: "[time]", token: Token.hex("#e09a4e"), rank: 85 },
	running: { glyph: "…", ascii: "[..]", token: Token.named("yellow"), rank: 35 },
	queued: { glyph: "·", ascii: "[.]", token: Token.named("brightBlack"), rank: 25 },
});

/**
 * A status name in {@link VitestAgentStatus}.
 *
 * @public
 */
export type VitestAgentStatusName = CoreStatusName | "timeout" | "running" | "queued";

/**
 * Named accents that are not statuses.
 *
 * @public
 */
export const VitestAgentTokens = {
	/** The `[flaky]` / `[new-failure]` classification tag on a failure line. */
	classification: Token.hex("#c98ae0"),
	/** A zero in a count column: present for alignment, not signal. */
	zero: Token.named("brightBlack"),
	/** The `stable` trend direction. */
	stable: Token.named("brightBlack"),
	/** A non-zero tag count. */
	tag: Token.named("cyan"),
} as const;

/**
 * The kit's default style for every semantic token.
 *
 * @remarks
 * Mirrors `@effected/cli`'s `CliTheme` defaults, which the kit does not
 * export; `__test__/theme.test.ts` fails if the two drift.
 *
 * @internal
 */
export const TOKEN_STYLES: Readonly<Record<TokenName, Style>> = {
	success: { fg: "green" },
	failure: { fg: "red" },
	error: { fg: "red", bold: true },
	warning: { fg: "yellow" },
	info: { fg: "cyan" },
	muted: { dim: true },
	accent: { fg: "cyan" },
	emphasis: { bold: true },
};

/**
 * The subset of Ink's `<Text>` props a `Style` maps onto.
 *
 * @public
 */
export interface InkTextStyle {
	readonly color?: string;
	readonly bold?: boolean;
	readonly dimColor?: boolean;
	readonly italic?: boolean;
	readonly underline?: boolean;
}

/** `brightRed` (kit) → `redBright` (chalk, which Ink's `color` prop takes). */
const inkColor = (fg: NamedColor | `#${string}`): string =>
	fg.startsWith("bright") ? `${fg.charAt(6).toLowerCase()}${fg.slice(7)}Bright` : fg;

/**
 * Ink `<Text>` props for a semantic token or an explicit style.
 *
 * @param token - a token name or a `Style`
 * @public
 */
export const inkStyle = (token: TokenName | Style): InkTextStyle => {
	const style = typeof token === "string" ? TOKEN_STYLES[token] : token;
	return {
		...(style.fg !== undefined ? { color: inkColor(style.fg) } : {}),
		...(style.bold === true ? { bold: true } : {}),
		...(style.dim === true ? { dimColor: true } : {}),
		...(style.italic === true ? { italic: true } : {}),
		...(style.underline === true ? { underline: true } : {}),
	};
};

/**
 * The Unicode glyph of a status.
 *
 * @param name - a status in {@link VitestAgentStatus}
 * @public
 */
export const statusGlyph = (name: VitestAgentStatusName): string => VitestAgentStatus.def(name).glyph;

/**
 * Ink `<Text>` props for a status's glyph.
 *
 * @param name - a status in {@link VitestAgentStatus}
 * @public
 */
export const statusInkStyle = (name: VitestAgentStatusName): InkTextStyle =>
	inkStyle(VitestAgentStatus.def(name).token);

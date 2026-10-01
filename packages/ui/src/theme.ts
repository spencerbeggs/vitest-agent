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
 * Ink takes colour as `<Text>` props, not ANSI, so {@link inkStyle}
 * resolves a token through the kit's pure `Token.resolve` (the same
 * resolution `CliTheme.paint` and `StreamTheme.style` apply) and maps the
 * resulting `Style` onto Ink's props. Glyphs follow a `GlyphSet` passed in
 * (`Glyphs.select`), never `process`: Unicode unless a caller asks for the
 * ASCII fallback.
 *
 * @packageDocumentation
 */

import type { CoreStatusName, GlyphSet, Style, TokenName } from "@effected/cli";
import { Glyphs, Status, Token } from "@effected/cli";

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
	queued: { glyph: "·", ascii: "[.]", token: Token.named("blackBright"), rank: 25 },
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
	zero: Token.named("blackBright"),
	/** The `stable` trend direction. */
	stable: Token.named("blackBright"),
	/** A non-zero tag count. */
	tag: Token.named("cyan"),
} as const;

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

/**
 * Ink `<Text>` props for a semantic token or an explicit style.
 *
 * @remarks
 * The kit spells `NamedColor` the way chalk (and so Ink's `color` prop)
 * does, so a resolved foreground passes straight through.
 *
 * @param token - a token name or a `Style`
 * @public
 */
export const inkStyle = (token: TokenName | Style): InkTextStyle => {
	const style = Token.resolve(token);
	return {
		...(style.fg !== undefined ? { color: style.fg } : {}),
		...(style.bold === true ? { bold: true } : {}),
		...(style.dim === true ? { dimColor: true } : {}),
		...(style.italic === true ? { italic: true } : {}),
		...(style.underline === true ? { underline: true } : {}),
	};
};

/**
 * The glyph of a status in a glyph set: its Unicode glyph, or its ASCII
 * fallback when `glyphs` is the kit's ASCII set.
 *
 * @param name - a status in {@link VitestAgentStatus}
 * @param glyphs - the glyph set, from `Glyphs.select`; Unicode by default
 * @public
 */
export const statusGlyph = (name: VitestAgentStatusName, glyphs: GlyphSet = Glyphs.unicode): string => {
	const def = VitestAgentStatus.def(name);
	return glyphs.kind === "ascii" ? def.ascii : def.glyph;
};

/**
 * Ink `<Text>` props for a status's glyph.
 *
 * @param name - a status in {@link VitestAgentStatus}
 * @public
 */
export const statusInkStyle = (name: VitestAgentStatusName): InkTextStyle =>
	inkStyle(VitestAgentStatus.def(name).token);

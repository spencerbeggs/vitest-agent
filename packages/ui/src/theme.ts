/**
 * The one vitest-agent status vocabulary and its bridge to Ink.
 *
 * Every glyph and colour the render paths draw with comes from here:
 * `VitestAgentStatus` is `@effected/cli-kit`'s core vocabulary (success, skip,
 * pending, info, warning, failure) extended with the three statuses a test
 * run adds (timeout, running, queued), and the non-status accents (the
 * classification tag, a zero count, the `stable` trend) are named
 * {@link VitestAgentTokens}. The kit's drift decisions apply by
 * construction: skip is `muted`, a regressing trend is `warning`, a coverage
 * threshold failure is `failure` and a target shortfall is `warning`.
 *
 * This module loads no React, so it names tokens and leaves painting to the
 * tree: an Ink component draws a token through the kit's `Styled` or `useStyle`
 * (`@effected/cli-kit/ui`), which resolve it against the mounted screen's theme,
 * and takes a status's token from {@link statusToken}. The pure
 * {@link inkStyle} and {@link statusInkStyle} stay for callers outside a tree
 * and see only the default palette. Glyphs follow a `GlyphSet` passed in
 * (`Glyphs.select`), never `process`: Unicode unless a caller asks for the
 * ASCII fallback.
 *
 * @packageDocumentation
 */

import type { CoreStatusName, GlyphSet, Style, TokenName } from "@effected/cli-kit";
import { Glyphs, Status, Token } from "@effected/cli-kit";
import { inkProps } from "@effected/cli-kit/ui";

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
 * Ink `<Text>` props for a semantic token or an explicit style, from the
 * default palette.
 *
 * @remarks
 * Resolves the token through the kit's pure `Token.resolve` and maps the
 * `Style` with the kit's `inkProps`. It sees no mounted theme, so a consumer's
 * token override never reaches it. No colour level reaches this call site
 * either, so `inkProps` with no level emits every prop and Ink's own chalk
 * level gates what is drawn.
 *
 * @param token - a token name or a `Style`
 * @deprecated Ignores the mounted theme. In a component use `useStyle` or
 * `Styled` from `@effected/cli-kit/ui`, which take the same token.
 * @public
 */
export const inkStyle = (token: TokenName | Style): InkTextStyle => inkProps(Token.resolve(token));

/**
 * The glyph of a status in a glyph set: its Unicode glyph, or its ASCII
 * fallback when `glyphs` is the kit's ASCII set (the kit's `Status.glyph`).
 *
 * @param name - a status in {@link VitestAgentStatus}
 * @param glyphs - the glyph set, from `Glyphs.select`; Unicode by default
 * @public
 */
export const statusGlyph = (name: VitestAgentStatusName, glyphs: GlyphSet = Glyphs.unicode): string =>
	VitestAgentStatus.glyph(name, glyphs);

/**
 * The token a status paints with, for the Ink components to resolve against the
 * mounted theme. Not part of the package entry: a consumer reads
 * `VitestAgentStatus.def(name).token`.
 *
 * @internal
 */
export const statusToken = (name: VitestAgentStatusName): TokenName | Style => VitestAgentStatus.def(name).token;

/**
 * Ink `<Text>` props for a status's glyph, from the default palette.
 *
 * @param name - a status in {@link VitestAgentStatus}
 * @deprecated Ignores the mounted theme. In a component pass
 * `VitestAgentStatus.def(name).token` to `useStyle` or `Styled` from
 * `@effected/cli-kit/ui`.
 * @public
 */
export const statusInkStyle = (name: VitestAgentStatusName): InkTextStyle =>
	inkStyle(VitestAgentStatus.def(name).token);

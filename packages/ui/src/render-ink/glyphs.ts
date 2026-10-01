/**
 * The glyph set the Ink tree draws status glyphs and spinner frames with.
 *
 * Ink components take no Effect context, so the set travels as React
 * context: `StreamApp` provides the set its `glyphs` prop selects
 * (`Glyphs.select`), and a host rendering a leaf component directly wraps
 * it in `GlyphSetContext.Provider`. The default is the Unicode set, and
 * nothing here reads `process`.
 */

import type { GlyphSet } from "@effected/cli";
import { Glyphs } from "@effected/cli";
import { createContext, useContext } from "react";

/**
 * React context carrying the kit `GlyphSet` the Ink components draw with;
 * `Glyphs.unicode` when no provider is mounted.
 *
 * @public
 */
export const GlyphSetContext = createContext<GlyphSet>(Glyphs.unicode);

/** The glyph set in effect for the calling component. */
export const useGlyphs = (): GlyphSet => useContext(GlyphSetContext);

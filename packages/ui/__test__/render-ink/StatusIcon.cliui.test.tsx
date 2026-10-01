/**
 * Dogfood probe (effected interactive-cli-kit round 4): mount a plain Ink
 * component, one the reporter mounts itself, through the kit's
 * `CliUiTest.render`. A kit `Screen` is `(control) => ReactElement`, so the
 * component is wrapped in a screen that never resolves; the harness unmounts
 * when the scope closes.
 */

import { Glyphs } from "@effected/cli";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { GlyphSetContext } from "../../src/render-ink/glyphs.js";
import { StatusIcon } from "../../src/render-ink/index.js";
import { statusGlyph } from "../../src/theme.js";

const run = <A,>(effect: Effect.Effect<A, never, never>): Promise<A> => Effect.runPromise(effect);

describe("StatusIcon through CliUiTest.render", () => {
	it("draws the Unicode failure glyph in the plain frame", async () => {
		const plain = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const screen = yield* CliUiTest.render(() => <StatusIcon status="failed" />, { columns: 40 });
					return yield* screen.plainFrame;
				}),
			),
		);
		expect(plain).toBe(statusGlyph("failure"));
	});

	it("keeps our own glyph context: the harness glyphs option does not reach GlyphSetContext", async () => {
		const plain = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const screen = yield* CliUiTest.render(() => <StatusIcon status="failed" />, { glyphs: "ascii" });
					return yield* screen.plainFrame;
				}),
			),
		);
		// Our components read GlyphSetContext, not the kit's useGlyphs, so the
		// harness's ASCII set is invisible to them until P5 (F8).
		expect(plain).toBe(statusGlyph("failure"));
		expect(plain).not.toBe(statusGlyph("failure", Glyphs.ascii));
	});

	it("draws ASCII when our own GlyphSetContext provider wraps the element", async () => {
		const plain = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const screen = yield* CliUiTest.render(() => (
						<GlyphSetContext.Provider value={Glyphs.ascii}>
							<StatusIcon status="failed" />
						</GlyphSetContext.Provider>
					));
					return yield* screen.plainFrame;
				}),
			),
		);
		expect(plain).toBe(statusGlyph("failure", Glyphs.ascii));
	});

	it("styled frame decodes our raw Ink colour props as SGR tags, not theme tokens", async () => {
		const frames = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const screen = yield* CliUiTest.render(() => <StatusIcon status="failed" />, { color: "truecolor" });
					return { styled: yield* screen.frame, raw: yield* screen.rawFrame };
				}),
			),
		);
		// Our props bypass the kit theme, so the marker palette cannot name a
		// token; the frame falls back to the SGR colour name.
		expect(frames.styled).toBe(`[fg:red]${statusGlyph("failure")}[/fg]`);
		expect(frames.raw).toBe(`\u001b[31m${statusGlyph("failure")}\u001b[39m`);
	});
});

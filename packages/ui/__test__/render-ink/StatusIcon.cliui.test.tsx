/**
 * Dogfood probe (effected interactive-cli-kit round 5): mount a plain Ink
 * component, one the reporter mounts itself, through the kit's
 * `CliUiTest.view` — a display-only element under the kit's providers, with
 * no result to wait for; the harness unmounts when the scope closes.
 */

import { Glyphs } from "@effected/cli";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { StatusIcon } from "../../src/render-ink/index.js";
import { statusGlyph } from "../../src/theme.js";

const run = <A,>(effect: Effect.Effect<A, never, never>): Promise<A> => Effect.runPromise(effect);

describe("StatusIcon through CliUiTest.view", () => {
	it("draws the Unicode failure glyph in the plain frame", async () => {
		const plain = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const screen = yield* CliUiTest.view(<StatusIcon status="failed" />, { columns: 40 });
					return yield* screen.plainFrame;
				}),
			),
		);
		expect(plain).toBe(statusGlyph("failure"));
	});

	it("draws the harness's ASCII set: our components read the kit's useGlyphs", async () => {
		const plain = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const screen = yield* CliUiTest.view(<StatusIcon status="failed" />, { glyphs: "ascii" });
					return yield* screen.plainFrame;
				}),
			),
		);
		expect(plain).toBe(statusGlyph("failure", Glyphs.ascii));
		expect(plain).not.toBe(statusGlyph("failure"));
	});

	it("styled frame decodes our raw Ink colour props as SGR tags, not theme tokens", async () => {
		const frames = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const screen = yield* CliUiTest.view(<StatusIcon status="failed" />, { color: "truecolor" });
					return { styled: yield* screen.frame, raw: yield* screen.rawFrame };
				}),
			),
		);
		// Our props bypass the kit theme, so the marker palette cannot name a
		// token; the frame falls back to the SGR colour name.
		expect(frames.styled).toBe(`[fg:red]${statusGlyph("failure")}[/fg]`);
		expect(frames.raw).toBe(`\u001b[31m${statusGlyph("failure")}\u001b[39m`);
	});

	it("rerenders a new element in place", async () => {
		const frames = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const view = yield* CliUiTest.view(<StatusIcon status="failed" />);
					const before = yield* view.plainFrame;
					yield* view.rerender(<StatusIcon status="passed" />);
					return { before, after: yield* view.plainFrame };
				}),
			),
		);
		expect(frames).toEqual({ before: statusGlyph("failure"), after: statusGlyph("success") });
	});
});

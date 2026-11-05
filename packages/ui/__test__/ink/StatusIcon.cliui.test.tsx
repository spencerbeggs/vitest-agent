/**
 * Dogfood probe (effected interactive-cli-kit round 5): mount a plain Ink
 * component, one the reporter mounts itself, through the kit's
 * `CliUiTest.view` — a display-only element under the kit's providers, with
 * no result to wait for; the harness unmounts when the scope closes.
 */

import { Glyphs } from "@effected/cli-kit";
import { CliUiTest } from "@effected/cli-kit/ui/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { StatusIcon } from "../../src/ink/index.js";
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

	it("styled frame names the theme token: the glyph resolves through the mounted theme", async () => {
		const frames = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const screen = yield* CliUiTest.view(<StatusIcon status="failed" />, { color: "truecolor" });
					return { styled: yield* screen.frame, raw: yield* screen.rawFrame };
				}),
			),
		);
		expect(frames.styled).toBe(`[failure]${statusGlyph("failure")}[/failure]`);
		// The raw frame carries the harness's marker colour, not the default palette's red.
		expect(frames.raw).not.toContain("\u001b[31m");
		expect(CliUiTest.styled(frames.raw)).toBe(frames.styled);
	});

	it("styled frame keeps an explicit style's colour: a run status outside the kit's tokens", async () => {
		const styled = await run(
			Effect.scoped(
				Effect.gen(function* () {
					const screen = yield* CliUiTest.view(<StatusIcon status="timed-out" />, { color: "truecolor" });
					return yield* screen.frame;
				}),
			),
		);
		expect(styled).toBe(`[fg:#e09a4e]${statusGlyph("timeout")}[/fg]`);
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

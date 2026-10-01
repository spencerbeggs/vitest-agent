/**
 * The Ink bridge in `src/theme.ts`: the mirrored token defaults must match
 * the kit's own `CliTheme`, and a `Style` must map onto Ink's `<Text>` props.
 */

import type { TokenName } from "@effected/cli";
import { CliTheme, Token } from "@effected/cli";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { TOKEN_STYLES, VitestAgentStatus, inkStyle, statusGlyph, statusInkStyle } from "../src/theme.js";

const TOKENS: ReadonlyArray<TokenName> = [
	"success",
	"failure",
	"warning",
	"info",
	"error",
	"muted",
	"accent",
	"emphasis",
];

const theme = Effect.runSync(Effect.provide(CliTheme, CliTheme.layerTest({ color: "truecolor" })));

describe("theme — token mirror", () => {
	for (const name of TOKENS) {
		it(`TOKEN_STYLES.${name} paints exactly as the kit's ${name} token`, () => {
			expect(theme.sgr(TOKEN_STYLES[name])).toBe(theme.sgr(name));
		});
	}

	it("detects a drifted mirror (control)", () => {
		expect(theme.sgr({ fg: "magenta" })).not.toBe(theme.sgr("failure"));
	});
});

describe("theme — inkStyle", () => {
	it("maps a named token to Ink's color prop", () => {
		expect(inkStyle("failure")).toEqual({ color: "red" });
	});

	it("maps muted to dimColor, not a colour", () => {
		expect(inkStyle("muted")).toEqual({ dimColor: true });
	});

	it("maps error to a bold red", () => {
		expect(inkStyle("error")).toEqual({ color: "red", bold: true });
	});

	it("passes a hex foreground through", () => {
		expect(inkStyle(Token.hex("#e09a4e"))).toEqual({ color: "#e09a4e" });
	});

	it("renames the kit's bright colours to chalk's form", () => {
		expect(inkStyle(Token.named("brightBlack"))).toEqual({ color: "blackBright" });
		expect(inkStyle(Token.named("brightMagenta"))).toEqual({ color: "magentaBright" });
	});
});

describe("theme — VitestAgentStatus", () => {
	it("extends the core vocabulary with timeout, running and queued", () => {
		expect(statusGlyph("timeout")).toBe("⧖");
		expect(statusGlyph("running")).toBe("…");
		expect(statusGlyph("queued")).toBe("·");
		expect(statusInkStyle("timeout")).toEqual({ color: "#e09a4e" });
	});

	it("applies the kit's skip decision: muted", () => {
		expect(statusInkStyle("skip")).toEqual({ dimColor: true });
	});

	it("ranks a timeout under a failure and over a warning", () => {
		expect(VitestAgentStatus.worst(["warning", "timeout"])).toBe("timeout");
		expect(VitestAgentStatus.worst(["timeout", "failure"])).toBe("failure");
	});
});

/**
 * The Ink bridge in `src/theme.ts`: a token resolves through the kit's pure
 * `Token.resolve`, and the resolved `Style` maps onto Ink's `<Text>` props.
 */

import { Glyphs, Token } from "@effected/cli";
import { describe, expect, it } from "vitest";
import { VitestAgentStatus, inkStyle, statusGlyph, statusInkStyle } from "../src/theme.js";

describe("theme — inkStyle", () => {
	it("maps every kit token default onto Ink props", () => {
		expect(inkStyle("success")).toEqual({ color: "green" });
		expect(inkStyle("failure")).toEqual({ color: "red" });
		expect(inkStyle("error")).toEqual({ color: "red", bold: true });
		expect(inkStyle("warning")).toEqual({ color: "yellow" });
		expect(inkStyle("info")).toEqual({ color: "cyan" });
		expect(inkStyle("muted")).toEqual({ dimColor: true });
		expect(inkStyle("accent")).toEqual({ color: "cyan" });
		expect(inkStyle("emphasis")).toEqual({ bold: true });
	});

	it("maps italic and underline", () => {
		expect(inkStyle(Token.style({ italic: true, underline: true }))).toEqual({ italic: true, underline: true });
	});

	it("passes a hex foreground through", () => {
		expect(inkStyle(Token.hex("#e09a4e"))).toEqual({ color: "#e09a4e" });
	});

	it("passes the kit's chalk-spelled bright colours through unchanged", () => {
		expect(inkStyle(Token.named("blackBright"))).toEqual({ color: "blackBright" });
		expect(inkStyle(Token.named("magentaBright"))).toEqual({ color: "magentaBright" });
		expect(inkStyle(Token.named("gray"))).toEqual({ color: "gray" });
	});
});

describe("theme — VitestAgentStatus", () => {
	it("extends the core vocabulary with timeout, running and queued", () => {
		expect(statusGlyph("timeout")).toBe("⧖");
		expect(statusGlyph("running")).toBe("…");
		expect(statusGlyph("queued")).toBe("·");
		expect(statusInkStyle("timeout")).toEqual({ color: "#e09a4e" });
		expect(statusInkStyle("queued")).toEqual({ color: "blackBright" });
	});

	it("draws the ASCII fallback from an ASCII glyph set", () => {
		const ascii = Glyphs.select({ ascii: true });
		expect(statusGlyph("timeout", ascii)).toBe("[time]");
		expect(statusGlyph("queued", ascii)).toBe("[.]");
		expect(statusGlyph("failure", ascii)).toBe(VitestAgentStatus.def("failure").ascii);
		expect(statusGlyph("failure", ascii)).not.toBe(statusGlyph("failure"));
		expect(statusGlyph("failure", Glyphs.select({ term: "dumb" }))).toBe(statusGlyph("failure", ascii));
		expect(statusGlyph("failure", Glyphs.select({ term: "xterm-256color" }))).toBe(statusGlyph("failure"));
	});

	it("applies the kit's skip decision: muted", () => {
		expect(statusInkStyle("skip")).toEqual({ dimColor: true });
	});

	it("ranks a timeout under a failure and over a warning", () => {
		expect(VitestAgentStatus.worst(["warning", "timeout"])).toBe("timeout");
		expect(VitestAgentStatus.worst(["timeout", "failure"])).toBe("failure");
	});
});

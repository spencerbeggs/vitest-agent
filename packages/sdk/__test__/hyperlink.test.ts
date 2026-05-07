import { describe, expect, it } from "vitest";
import { osc8 } from "../src/utils/hyperlink.js";

describe("osc8", () => {
	it("returns a labeled OSC-8 escape sequence when enabled", () => {
		const out = osc8("https://example.com", "Click me", { enabled: true });
		expect(out).toBe("\x1b]8;;https://example.com\x07Click me\x1b]8;;\x07");
	});

	it("returns plain text when disabled", () => {
		const out = osc8("https://example.com", "Click me", { enabled: false });
		expect(out).toBe("Click me");
	});

	it("respects NO_COLOR via the disabled fallback", () => {
		const out = osc8("https://example.com", "Click me", { enabled: false });
		expect(out).not.toContain("\x1b");
	});
});

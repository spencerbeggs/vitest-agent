/**
 * `buildUnexpectedToolErrorEnvelope` (issue #191, sub-item A).
 *
 * A resolver throw that escapes a tool's own domain-specific error
 * handling (the tagged-error `catchTags` used by `_tdd-error-envelope.ts`,
 * for example) currently falls through to the MCP SDK's generic,
 * untyped `createToolError` text-only result. This pure builder produces
 * the same `{ ok: false, error: { _tag, ... } }` envelope shape the rest
 * of the tool surface already uses, so `server.ts`'s catch-all wrapper
 * can hand the agent something structured instead of a bare string.
 */

import { describe, expect, it } from "vitest";
import { buildUnexpectedToolErrorEnvelope } from "../src/utils/tool-error-envelope.js";

// (red-phase re-author touch — see issue #191 phase-window gotcha)

describe("buildUnexpectedToolErrorEnvelope", () => {
	it("carries the tool name, an ok:false discriminant, and the error message", () => {
		const envelope = buildUnexpectedToolErrorEnvelope("cache_health", new Error("boom: injected resolver failure"));

		expect(envelope.ok).toBe(false);
		expect(envelope.error._tag).toBe("UnexpectedToolError");
		expect(envelope.error.tool).toBe("cache_health");
		expect(envelope.error.message).toBe("boom: injected resolver failure");
		expect(envelope.error.remediation.suggestedTool).toBe("cache_health");
		expect(envelope.error.remediation.humanHint).toContain("cache_health");
	});

	it("coerces a non-Error throw into a string message instead of crashing on .message access", () => {
		const envelope = buildUnexpectedToolErrorEnvelope("ping", "a bare string throw");

		expect(envelope.error.message).toBe("a bare string throw");
	});
});

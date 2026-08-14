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

	// Issue #243: the builder's own introspection was unguarded. `err
	// instanceof Error` walks the prototype chain and `String(err)` invokes
	// Symbol.toPrimitive/toString — a Proxy can make either throw, and a
	// throw here escapes the wrapper that exists to keep the agent's
	// response structured.
	it("survives a value whose getPrototypeOf trap throws (instanceof is not safe)", () => {
		const hostile = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error("getPrototypeOf trap detonated");
				},
			},
		);

		expect(() => hostile instanceof Error).toThrow();

		const envelope = buildUnexpectedToolErrorEnvelope("run_tests", hostile);
		expect(envelope.ok).toBe(false);
		expect(envelope.error._tag).toBe("UnexpectedToolError");
		expect(envelope.error.tool).toBe("run_tests");
		expect(typeof envelope.error.message).toBe("string");
	});

	it("survives a value whose every trap throws (String() is not safe either)", () => {
		const hostile = new Proxy(
			{},
			{
				get() {
					throw new Error("get trap detonated");
				},
				has() {
					throw new Error("has trap detonated");
				},
				getPrototypeOf() {
					throw new Error("getPrototypeOf trap detonated");
				},
			},
		);

		const envelope = buildUnexpectedToolErrorEnvelope("test_history", hostile);
		expect(envelope.error.message).toBe("<unreadable thrown value>");
		// The envelope still has to be JSON-serializable — server.ts writes
		// it into both the text channel and structuredContent.
		expect(() => JSON.stringify(envelope)).not.toThrow();
	});

	it("survives an Error whose .message getter throws", () => {
		const hostile = new Proxy(new Error("never read"), {
			get(_target, prop) {
				if (prop === "message") throw new Error("message getter detonated");
				return undefined;
			},
		});

		const envelope = buildUnexpectedToolErrorEnvelope("note", hostile);
		expect(envelope.error.message).toBe("<unreadable Error.message>");
	});

	it("stringifies an Error whose .message is not a string", () => {
		const hostile = new Proxy(new Error("never read"), {
			get(target, prop, receiver) {
				if (prop === "message") return { not: "a string" };
				return Reflect.get(target, prop, receiver);
			},
		});

		const envelope = buildUnexpectedToolErrorEnvelope("note", hostile);
		expect(typeof envelope.error.message).toBe("string");
		expect(envelope.error.message).toContain("object");
	});
});

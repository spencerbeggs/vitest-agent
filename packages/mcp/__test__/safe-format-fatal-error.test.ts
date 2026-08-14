/**
 * `safeFormatFatalError` (issue #243).
 *
 * `bin.ts`'s process-level crash guards (issue #191) called
 * `formatFatalError` directly. That formatter introspects the value it is
 * handed — `Symbol.for("effect/Runtime/FiberFailure/Cause") in reason`,
 * `err instanceof Error`, `JSON.stringify(err)` — and each of those is
 * hijackable by a `Proxy` whose `has` / `getPrototypeOf` / `get` trap
 * throws. A throw inside an `uncaughtException` handler kills the process
 * outright, so the guard that exists to keep an MCP session alive was
 * itself a crash vector.
 */

import { formatFatalError } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { UNFORMATTABLE_ERROR_TEXT, safeFormatFatalError } from "../src/utils/safe-format-fatal-error.js";

const hostileProxy = (traps: ProxyHandler<object>) => new Proxy({}, traps);

describe("safeFormatFatalError", () => {
	it("passes ordinary errors through to formatFatalError unchanged", () => {
		const err = new Error("ordinary boom");
		expect(safeFormatFatalError(err)).toBe(formatFatalError(err));
		expect(safeFormatFatalError(err)).toContain("ordinary boom");
	});

	it("passes non-Error values through unchanged", () => {
		expect(safeFormatFatalError("a bare string rejection")).toContain("a bare string rejection");
		expect(safeFormatFatalError(null)).toContain("null");
	});

	it("returns the fixed fallback when the value's `has` trap throws", () => {
		// `Cause.isCause(err)` / the FiberFailure symbol probe both use the
		// `in` operator, which routes through the `has` trap.
		const hostile = hostileProxy({
			has() {
				throw new Error("has trap detonated");
			},
		});

		expect(() => formatFatalError(hostile)).toThrow();
		expect(safeFormatFatalError(hostile)).toBe(UNFORMATTABLE_ERROR_TEXT);
	});

	it("returns the fixed fallback when the value's getPrototypeOf trap throws", () => {
		const hostile = hostileProxy({
			getPrototypeOf() {
				throw new Error("getPrototypeOf trap detonated");
			},
		});

		expect(() => formatFatalError(hostile)).toThrow();
		expect(safeFormatFatalError(hostile)).toBe(UNFORMATTABLE_ERROR_TEXT);
	});

	it("returns the fixed fallback when every trap throws", () => {
		const hostile = hostileProxy({
			get() {
				throw new Error("get trap detonated");
			},
			has() {
				throw new Error("has trap detonated");
			},
			ownKeys() {
				throw new Error("ownKeys trap detonated");
			},
			getPrototypeOf() {
				throw new Error("getPrototypeOf trap detonated");
			},
		});

		expect(safeFormatFatalError(hostile)).toBe(UNFORMATTABLE_ERROR_TEXT);
	});

	it("never throws, whatever it is given", () => {
		const values: ReadonlyArray<unknown> = [
			undefined,
			Number.NaN,
			Symbol("sym"),
			hostileProxy({
				has() {
					throw new Error("boom");
				},
			}),
			hostileProxy({
				getPrototypeOf() {
					throw new Error("boom");
				},
			}),
		];

		for (const value of values) {
			expect(() => safeFormatFatalError(value)).not.toThrow();
			expect(typeof safeFormatFatalError(value)).toBe("string");
		}
	});
});

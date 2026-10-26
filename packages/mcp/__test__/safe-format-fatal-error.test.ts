/**
 * `safeFormatFatalError` (issue #243).
 *
 * `bin.ts`'s process-level crash guards (issue #191) called
 * `formatFatalError` directly. The sdk formatter it used then introspected
 * the value it was handed, and each probe was hijackable by a `Proxy` whose
 * `has` / `getPrototypeOf` / `get` trap throws. A throw inside an
 * `uncaughtException` handler kills the process outright, so the guard that
 * exists to keep an MCP session alive was itself a crash vector. The engine
 * formatter that replaced it is total; the wrapper stays as a second guard.
 */

import { formatFatalError } from "@vitest-agent/engine";
import { describe, expect, it } from "vitest";
import { safeFormatFatalError } from "../src/utils/safe-format-fatal-error.js";

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

	// The engine's formatter is total since it moved onto CliFailure: a
	// hostile Proxy no longer makes it throw, so the wrapper passes its
	// marker through. The fixed fallback for a formatter that does throw is
	// pinned in safe-format-fatal-error-fallback.test.ts.
	it("passes the formatter's own marker through for a Proxy whose `has` trap throws", () => {
		const hostile = hostileProxy({
			has() {
				throw new Error("has trap detonated");
			},
		});

		expect(() => formatFatalError(hostile)).not.toThrow();
		expect(safeFormatFatalError(hostile)).toBe(formatFatalError(hostile));
	});

	it("passes the formatter's own marker through for a Proxy whose getPrototypeOf trap throws", () => {
		const hostile = hostileProxy({
			getPrototypeOf() {
				throw new Error("getPrototypeOf trap detonated");
			},
		});

		expect(() => formatFatalError(hostile)).not.toThrow();
		expect(safeFormatFatalError(hostile)).toBe(formatFatalError(hostile));
	});

	it("passes the formatter's own marker through when every trap throws", () => {
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

		expect(safeFormatFatalError(hostile)).toContain("<unserializable error>");
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

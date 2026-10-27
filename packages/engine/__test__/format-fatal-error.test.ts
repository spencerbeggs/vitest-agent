import { Data, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { formatFatalError } from "../src/utils/format-fatal-error.js";

class Broken extends Data.TaggedError("Broken")<{ readonly message: string }> {}

const FOOTER = "\nPlease report at https://github.com/spencerbeggs/vitest-agent/issues";

/** What a real Effect v4 `runPromise` rejects with. */
const rejectionOf = <E>(effect: Effect.Effect<never, E>): Promise<unknown> =>
	Effect.runPromise(effect).then(
		() => {
			throw new Error("expected the effect to fail");
		},
		(err: unknown) => err,
	);

describe("formatFatalError", () => {
	it("formats what a v4 runPromise rejects with: the typed error, its message, and its stack", async () => {
		const err = await rejectionOf(Effect.fail(new Broken({ message: "the store is gone" })));
		// v4 rejects with the error itself — no FiberFailure wrapper.
		expect(err).toBeInstanceOf(Broken);

		const text = formatFatalError(err);

		expect(text).toContain("Broken: the store is gone");
		expect(text).toMatch(/\n\s+at .*format-fatal-error\.test\.ts/);
		expect(text.endsWith(FOOTER)).toBe(true);
	});

	it("formats a defect a v4 runPromise rejects with", async () => {
		const err = await rejectionOf(Effect.die(new Error("invariant broke")));

		expect(formatFatalError(err)).toContain("Error: invariant broke");
	});

	it("renders every reason of a Cause handed over whole, with its span trail", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.fail(new Broken({ message: "typed failure" })).pipe(Effect.withSpan("persistRun")),
		);
		if (!Exit.isFailure(exit)) throw new Error("expected a failure");

		const text = formatFatalError(exit.cause);

		expect(text).toContain("Broken: typed failure");
		expect(text).toContain("in: persistRun");
	});

	it("follows an Error.cause chain", () => {
		const text = formatFatalError(new Error("outer", { cause: new Error("root cause") }));

		expect(text).toContain("Error: outer");
		expect(text).toContain("root cause");
	});

	it("renders a non-Error value as its text", () => {
		expect(formatFatalError("plain string")).toContain("plain string");
		expect(formatFatalError(undefined)).toContain("undefined");
	});

	it("renders the message when the error's stack getter throws", () => {
		class Hostile extends Error {}
		const err = new Hostile("h");
		Object.defineProperty(err, "stack", {
			get() {
				throw new Error("no stack for you");
			},
		});

		expect(formatFatalError(err)).toBe(`✗ Error: h\nstack\n  no stack${FOOTER}`);
	});

	it("renders a plain object whose message getter and toString both throw as unprintable (issue #193)", () => {
		const err: Record<string, unknown> = { cause: Object.create(null) };
		Object.defineProperty(err, "message", {
			get() {
				return (this as { cause: { toString(): string } }).cause.toString();
			},
			enumerable: true,
		});
		Object.defineProperty(err, "toString", {
			get(): never {
				throw new TypeError("no toString for you");
			},
		});

		// CliFailure renders a value it cannot print as a marker of its own.
		expect(formatFatalError(err)).toBe(`✗ [unprintable value]${FOOTER}`);
	});

	it("never throws on a Proxy whose traps all throw (issue #243)", () => {
		const detonate = () => {
			throw new Error("trap detonated");
		};
		const hostile = new Proxy({}, { get: detonate, has: detonate, ownKeys: detonate, getPrototypeOf: detonate });

		expect(formatFatalError(hostile)).toBe(`<unserializable error>${FOOTER}`);
	});

	it("renders an unprintable value when the message and constructor getters both throw", () => {
		const err = new Error("h");
		Object.defineProperty(err, "message", {
			get() {
				throw new Error("no message");
			},
		});
		Object.defineProperty(err, "constructor", {
			get() {
				throw new Error("no constructor");
			},
		});

		expect(formatFatalError(err)).toBe(`✗ [unprintable value]\nstack\n  no stack${FOOTER}`);
	});
});

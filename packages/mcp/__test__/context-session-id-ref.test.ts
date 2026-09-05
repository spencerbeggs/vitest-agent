import { describe, expect, it } from "vitest";
import { createCurrentSessionIdRef } from "../src/context.js";

/**
 * `createCurrentSessionIdRef` is backed by Effect's `MutableRef` rather than
 * a hand-rolled closure cell (issue #331). The observable contract is a
 * plain get/set cell, so these cases pin that contract independently of the
 * backing primitive.
 */
describe("createCurrentSessionIdRef", () => {
	it("defaults to null when constructed with no initial value", () => {
		expect(createCurrentSessionIdRef().get()).toBeNull();
	});

	it("returns the initial value unchanged", () => {
		expect(createCurrentSessionIdRef("chat-1").get()).toBe("chat-1");
	});

	it("returns an explicit null initial value", () => {
		expect(createCurrentSessionIdRef(null).get()).toBeNull();
	});

	it("reflects a set() in subsequent get() calls", () => {
		const ref = createCurrentSessionIdRef();
		ref.set("chat-2");
		expect(ref.get()).toBe("chat-2");
	});

	it("is latest-wins across repeated set() calls", () => {
		const ref = createCurrentSessionIdRef("chat-1");
		ref.set("chat-2");
		ref.set("chat-3");
		expect(ref.get()).toBe("chat-3");
	});

	it("clears back to null via set(null)", () => {
		const ref = createCurrentSessionIdRef("chat-1");
		ref.set(null);
		expect(ref.get()).toBeNull();
	});

	it("returns a stable value across repeated reads without a set()", () => {
		const ref = createCurrentSessionIdRef("chat-1");
		expect(ref.get()).toBe("chat-1");
		expect(ref.get()).toBe("chat-1");
	});

	it("gives each instance its own cell", () => {
		const a = createCurrentSessionIdRef("chat-a");
		const b = createCurrentSessionIdRef("chat-b");
		a.set("chat-a2");
		expect(a.get()).toBe("chat-a2");
		expect(b.get()).toBe("chat-b");
	});
});

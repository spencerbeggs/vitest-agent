/**
 * The lazy-recovery contract of `createSessionContextRef`. The recovery
 * program itself (`recoverSessionContextFromSessionEnv`) lives in
 * `@vitest-agent/engine` and is tested there; this file covers only the
 * MCP-side ref that invokes it.
 */

import { describe, expect, it } from "vitest";
import { createSessionContextRef } from "../src/session.js";

describe("createSessionContextRef lazy recovery", () => {
	it("invokes recover while null and caches the first non-null result", () => {
		let calls = 0;
		const results = [null, { chatId: "c", conversationId: "v", mainAgentId: "a" }] as const;
		const ref = createSessionContextRef(null, () => {
			const r = results[Math.min(calls, 1)] ?? null;
			calls += 1;
			return r;
		});
		expect(ref.get()).toBeNull();
		expect(calls).toBe(1);
		expect(ref.get()?.chatId).toBe("c");
		expect(calls).toBe(2);
		// Cached — recover is not called again.
		expect(ref.get()?.chatId).toBe("c");
		expect(calls).toBe(2);
	});

	it("does not recover when constructed with an initial value", () => {
		let calls = 0;
		const ref = createSessionContextRef({ chatId: "boot", conversationId: "v", mainAgentId: "a" }, () => {
			calls += 1;
			return null;
		});
		expect(ref.get()?.chatId).toBe("boot");
		expect(calls).toBe(0);
	});

	it("set() overrides and stops further recovery", () => {
		let calls = 0;
		const ref = createSessionContextRef(null, () => {
			calls += 1;
			return null;
		});
		ref.set({ chatId: "explicit", conversationId: "v", mainAgentId: "a" });
		expect(ref.get()?.chatId).toBe("explicit");
		expect(calls).toBe(0);
	});
});

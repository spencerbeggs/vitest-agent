import type { ModuleRecord } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { ModuleHeader } from "../../src/ink/index.js";
import { renderInk } from "../utils/render-ink.js";

const moduleOf = (overrides: Partial<ModuleRecord> = {}): ModuleRecord => ({
	modulePath: "src/example.test.ts",
	status: "finished",
	passCount: 1,
	failCount: 0,
	skipCount: 0,
	timeoutCount: 0,
	durationMs: 12,
	tests: [],
	...overrides,
});

describe("ModuleHeader", () => {
	it("shows green check + counts for an all-pass module", async () => {
		const { frame } = await renderInk(<ModuleHeader module={moduleOf()} />);
		expect(frame).toMatchInlineSnapshot(`"✓ src/example.test.ts (1 passed, 12ms)"`);
	});

	it("shows red cross when failures are present", async () => {
		const { frame } = await renderInk(
			<ModuleHeader module={moduleOf({ passCount: 1, failCount: 2, durationMs: 30 })} />,
		);
		expect(frame).toMatchInlineSnapshot(`"✗ src/example.test.ts (1 passed, 2 failed, 30ms)"`);
	});

	it("shows queued glyph for an unstarted module", async () => {
		const { frame } = await renderInk(
			<ModuleHeader module={moduleOf({ status: "queued", passCount: 0, failCount: 0, durationMs: 0 })} />,
		);
		expect(frame).toMatchInlineSnapshot(`"· src/example.test.ts (queued, 0ms)"`);
	});

	it("shows running glyph while the module is in-flight", async () => {
		const { frame } = await renderInk(
			<ModuleHeader module={moduleOf({ status: "running", passCount: 1, failCount: 0, durationMs: 5 })} />,
		);
		expect(frame).toMatchInlineSnapshot(`"… src/example.test.ts (1 passed, 5ms)"`);
	});
});

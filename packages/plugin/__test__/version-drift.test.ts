/**
 * T12 integration test for the plugin's init-time drift warning.
 *
 * Spec: a single namespaced stderr line per mismatched peer, suppressed
 * on exact match, never throws. The check runs at the top of the
 * AgentPlugin() factory and is gated by a module-level boolean so
 * multi-project Vitest configs do not duplicate the warning.
 *
 * Imports go through dist/dev so the rslib-builder __PACKAGE_VERSION__
 * substitution is in effect — same pattern as version-constant.test.ts.
 * Tests use Vitest's vi.mock to swap CURRENT_SDK_VERSION /
 * CURRENT_REPORTER_VERSION before importing the plugin, then inspect
 * process.stderr to confirm the line shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("AgentPlugin version drift", () => {
	let stderrWrites: string[];
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stderrWrites = [];
		stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
			stderrWrites.push(String(chunk));
			return true;
		});
		vi.resetModules();
	});

	afterEach(() => {
		stderrSpy.mockRestore();
		vi.doUnmock("vitest-agent-sdk");
		vi.doUnmock("vitest-agent-reporter");
	});

	it("should emit one stderr line when CURRENT_SDK_VERSION drifts", async () => {
		const sdk = await vi.importActual<typeof import("vitest-agent-sdk")>("vitest-agent-sdk");
		vi.doMock("vitest-agent-sdk", () => ({ ...sdk, CURRENT_SDK_VERSION: "9.9.9-mismatch" }));

		const { AgentPlugin, CURRENT_PLUGIN_VERSION, _resetVersionDriftGuardForTests } = await import(
			"../dist/dev/index.js"
		);
		_resetVersionDriftGuardForTests();
		AgentPlugin();

		const driftLines = stderrWrites.filter((s) => s.includes("[vitest-agent-plugin] version drift"));
		expect(driftLines).toHaveLength(1);
		expect(driftLines[0]).toContain(`vitest-agent-plugin@${CURRENT_PLUGIN_VERSION}`);
		expect(driftLines[0]).toContain("vitest-agent-sdk@9.9.9-mismatch");
		expect(driftLines[0]).toContain("Reinstall vitest-agent-* packages so versions match.");
	});

	it("should emit one stderr line when CURRENT_REPORTER_VERSION drifts", async () => {
		const reporter = await vi.importActual<typeof import("vitest-agent-reporter")>("vitest-agent-reporter");
		vi.doMock("vitest-agent-reporter", () => ({
			...reporter,
			CURRENT_REPORTER_VERSION: "9.9.9-mismatch",
		}));

		const { AgentPlugin, _resetVersionDriftGuardForTests } = await import("../dist/dev/index.js");
		_resetVersionDriftGuardForTests();
		AgentPlugin();

		const driftLines = stderrWrites.filter((s) => s.includes("[vitest-agent-plugin] version drift"));
		expect(driftLines).toHaveLength(1);
		expect(driftLines[0]).toContain("vitest-agent-reporter@9.9.9-mismatch");
	});

	it("should emit two stderr lines when both SDK and REPORTER drift", async () => {
		const sdk = await vi.importActual<typeof import("vitest-agent-sdk")>("vitest-agent-sdk");
		const reporter = await vi.importActual<typeof import("vitest-agent-reporter")>("vitest-agent-reporter");
		vi.doMock("vitest-agent-sdk", () => ({ ...sdk, CURRENT_SDK_VERSION: "9.9.9-sdk" }));
		vi.doMock("vitest-agent-reporter", () => ({ ...reporter, CURRENT_REPORTER_VERSION: "9.9.9-rep" }));

		const { AgentPlugin, _resetVersionDriftGuardForTests } = await import("../dist/dev/index.js");
		_resetVersionDriftGuardForTests();
		AgentPlugin();

		const driftLines = stderrWrites.filter((s) => s.includes("[vitest-agent-plugin] version drift"));
		expect(driftLines).toHaveLength(2);
	});

	it("should be silent when all peer versions match (the common path)", async () => {
		const { AgentPlugin, _resetVersionDriftGuardForTests } = await import("../dist/dev/index.js");
		_resetVersionDriftGuardForTests();
		AgentPlugin();

		const driftLines = stderrWrites.filter((s) => s.includes("[vitest-agent-plugin] version drift"));
		expect(driftLines).toHaveLength(0);
	});

	it("should suppress repeat warnings after the first call (once-per-process gate)", async () => {
		const sdk = await vi.importActual<typeof import("vitest-agent-sdk")>("vitest-agent-sdk");
		vi.doMock("vitest-agent-sdk", () => ({ ...sdk, CURRENT_SDK_VERSION: "9.9.9-mismatch" }));

		const { AgentPlugin, _resetVersionDriftGuardForTests } = await import("../dist/dev/index.js");
		_resetVersionDriftGuardForTests();
		AgentPlugin();
		AgentPlugin();
		AgentPlugin();

		const driftLines = stderrWrites.filter((s) => s.includes("[vitest-agent-plugin] version drift"));
		expect(driftLines).toHaveLength(1);
	});
});

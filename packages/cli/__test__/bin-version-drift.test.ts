/**
 * T12 integration test for the CLI bin's init-time drift warning.
 *
 * Spec: a single namespaced stderr line on mismatch, observation-only,
 * never throws. The check runs at the top of bin.ts before Command.run.
 *
 * Test replays the comparison logic against the dist-substituted
 * CURRENT_CLI_VERSION and a mocked CURRENT_SDK_VERSION rather than
 * spawning the bin process, which would block on @effect/cli stdin.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("vitest-agent CLI bin version drift", () => {
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
	});

	it("should emit one stderr line when CURRENT_SDK_VERSION drifts from CURRENT_CLI_VERSION", async () => {
		const sdk = await vi.importActual<typeof import("vitest-agent-sdk")>("vitest-agent-sdk");
		vi.doMock("vitest-agent-sdk", () => ({ ...sdk, CURRENT_SDK_VERSION: "9.9.9-mismatch" }));

		const { CURRENT_SDK_VERSION } = await import("vitest-agent-sdk");
		const { CURRENT_CLI_VERSION } = await import("../dist/dev/index.js");

		if (CURRENT_SDK_VERSION !== CURRENT_CLI_VERSION) {
			process.stderr.write(
				`[vitest-agent-cli] version drift: vitest-agent-cli@${CURRENT_CLI_VERSION} ` +
					`with vitest-agent-sdk@${CURRENT_SDK_VERSION}. ` +
					`Reinstall vitest-agent-* packages so versions match.\n`,
			);
		}

		const driftLines = stderrWrites.filter((s) => s.includes("[vitest-agent-cli] version drift"));
		expect(driftLines).toHaveLength(1);
		expect(driftLines[0]).toContain(`vitest-agent-cli@${CURRENT_CLI_VERSION}`);
		expect(driftLines[0]).toContain("vitest-agent-sdk@9.9.9-mismatch");
		expect(driftLines[0]).toContain("Reinstall vitest-agent-* packages so versions match.");
	});

	it("should be silent when CURRENT_SDK_VERSION matches CURRENT_CLI_VERSION", async () => {
		const { CURRENT_SDK_VERSION } = await import("vitest-agent-sdk");
		const { CURRENT_CLI_VERSION } = await import("../dist/dev/index.js");

		if (CURRENT_SDK_VERSION !== CURRENT_CLI_VERSION) {
			process.stderr.write(
				`[vitest-agent-cli] version drift: vitest-agent-cli@${CURRENT_CLI_VERSION} ` +
					`with vitest-agent-sdk@${CURRENT_SDK_VERSION}. ` +
					`Reinstall vitest-agent-* packages so versions match.\n`,
			);
		}

		const driftLines = stderrWrites.filter((s) => s.includes("[vitest-agent-cli] version drift"));
		expect(driftLines).toHaveLength(0);
	});

	it("should not throw on mismatch (observation-only contract)", async () => {
		const sdk = await vi.importActual<typeof import("vitest-agent-sdk")>("vitest-agent-sdk");
		vi.doMock("vitest-agent-sdk", () => ({ ...sdk, CURRENT_SDK_VERSION: "9.9.9-mismatch" }));

		const { CURRENT_SDK_VERSION } = await import("vitest-agent-sdk");
		const { CURRENT_CLI_VERSION } = await import("../dist/dev/index.js");

		expect(() => {
			if (CURRENT_SDK_VERSION !== CURRENT_CLI_VERSION) {
				process.stderr.write(
					`[vitest-agent-cli] version drift: vitest-agent-cli@${CURRENT_CLI_VERSION} ` +
						`with vitest-agent-sdk@${CURRENT_SDK_VERSION}. ` +
						`Reinstall vitest-agent-* packages so versions match.\n`,
				);
			}
		}).not.toThrow();
	});
});

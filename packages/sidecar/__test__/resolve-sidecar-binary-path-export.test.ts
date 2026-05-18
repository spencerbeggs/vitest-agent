// Test that resolveSidecarBinaryPath is exported from the vitest-agent-sidecar barrel
import { describe, expect, it } from "vitest";

describe("resolveSidecarBinaryPath — sidecar barrel export", () => {
	it("should be exported from vitest-agent-sidecar barrel (packages/sidecar/src/index.ts)", async () => {
		// Given: the sidecar barrel index
		// When: dynamically importing resolveSidecarBinaryPath from the barrel
		const sidecarBarrel = await import("../src/index.js");

		// Then: the export is present and is a function
		expect(typeof sidecarBarrel.resolveSidecarBinaryPath).toBe("function");
	});
});

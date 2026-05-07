import { describe, expect, it } from "vitest";
import { captureSettings, hashSettings } from "../src/utils/capture-settings.js";

describe("captureSettings", () => {
	it("extracts known fields from Vitest config", () => {
		const config = {
			pool: "forks",
			testTimeout: 5000,
			hookTimeout: 10000,
			slowTestThreshold: 300,
			maxConcurrency: 5,
			maxWorkers: 4,
			isolate: true,
			bail: 0,
			globals: false,
			fileParallelism: true,
			sequence: { seed: 42 },
			environment: "node",
			coverage: { provider: "v8" },
		};
		const result = captureSettings(config, "4.1.0");
		expect(result.vitest_version).toBe("4.1.0");
		expect(result.pool).toBe("forks");
		expect(result.test_timeout).toBe(5000);
		expect(result.isolate).toBe(true);
		expect(result.sequence_seed).toBe(42);
		expect(result.coverage_provider).toBe("v8");
	});

	it("handles missing optional fields", () => {
		const result = captureSettings({}, "4.1.0");
		expect(result.vitest_version).toBe("4.1.0");
		expect(result.pool).toBeUndefined();
	});
});

describe("hashSettings", () => {
	it("produces consistent SHA-256 for same input", () => {
		const settings = { vitest_version: "4.1.0", pool: "forks" };
		const hash1 = hashSettings(settings);
		const hash2 = hashSettings(settings);
		expect(hash1).toBe(hash2);
		expect(hash1).toHaveLength(64);
	});

	it("produces different hash for different input", () => {
		const hash1 = hashSettings({ vitest_version: "4.1.0", pool: "forks" });
		const hash2 = hashSettings({ vitest_version: "4.1.0", pool: "threads" });
		expect(hash1).not.toBe(hash2);
	});
});

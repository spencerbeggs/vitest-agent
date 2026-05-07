/**
 * vitest-agent-sdk
 *
 * Tests for Effect Context.Tag service definitions provided by the shared
 * package. CoverageAnalyzer lives in the reporter package and is tested
 * there.
 */

import { Context } from "effect";
import { describe, expect, it } from "vitest";
import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";
import { EnvironmentDetector } from "../src/services/EnvironmentDetector.js";
import { ProjectDiscovery } from "../src/services/ProjectDiscovery.js";

describe("DataStore", () => {
	it("is a Context.Tag", () => {
		expect(DataStore.key).toBe("vitest-agent/DataStore");
	});
});

describe("DataReader", () => {
	it("is a Context.Tag", () => {
		expect(DataReader.key).toBe("vitest-agent/DataReader");
	});
});

describe("EnvironmentDetector", () => {
	it("is a Context.Tag", () => {
		expect(EnvironmentDetector.key).toBe("vitest-agent/EnvironmentDetector");
	});
});

describe("ProjectDiscovery", () => {
	it("is a valid Context.Tag", () => {
		expect(ProjectDiscovery).toBeDefined();
		expect(Context.isTag(ProjectDiscovery)).toBe(true);
	});
});

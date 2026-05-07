import { describe, expect, it } from "vitest";
import { splitProject } from "../src/utils/split-project.js";

describe("splitProject", () => {
	it("splits on first colon", () => {
		expect(splitProject("core:unit")).toEqual({ project: "core", subProject: "unit" });
	});

	it("handles multiple colons (splits on first only)", () => {
		expect(splitProject("core:unit:fast")).toEqual({ project: "core", subProject: "unit:fast" });
	});

	it("returns null subProject when no colon", () => {
		expect(splitProject("mylib")).toEqual({ project: "mylib", subProject: null });
	});

	it("uses 'default' for empty string", () => {
		expect(splitProject("")).toEqual({ project: "default", subProject: null });
	});

	it("uses 'default' for undefined", () => {
		expect(splitProject(undefined)).toEqual({ project: "default", subProject: null });
	});
});

import { describe, expect, it } from "vitest";
import { safeFilename } from "../src/utils/safe-filename.js";

describe("safeFilename", () => {
	it("replaces slashes and colons with double underscores", () => {
		expect(safeFilename("@savvy-web/my-lib:unit")).toBe("@savvy-web__my-lib__unit");
	});

	it("passes through plain names unchanged", () => {
		expect(safeFilename("core")).toBe("core");
	});

	it("returns 'default' for empty string", () => {
		expect(safeFilename("")).toBe("default");
	});

	it("replaces multiple slashes and colons", () => {
		expect(safeFilename("a/b:c/d:e")).toBe("a__b__c__d__e");
	});
});

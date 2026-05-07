import { describe, expect, it } from "vitest";
import { normalizeWorkspaceKey } from "../src/utils/normalize-workspace-key.js";

describe("normalizeWorkspaceKey", () => {
	it("passes plain ASCII names through unchanged", () => {
		expect(normalizeWorkspaceKey("my-app")).toBe("my-app");
		expect(normalizeWorkspaceKey("vitest-agent-reporter")).toBe("vitest-agent-reporter");
		expect(normalizeWorkspaceKey("ALPHA_NUM-123")).toBe("ALPHA_NUM-123");
	});

	it("preserves dots and at-signs", () => {
		expect(normalizeWorkspaceKey("foo.bar")).toBe("foo.bar");
		expect(normalizeWorkspaceKey("@scoped")).toBe("@scoped");
	});

	it("converts scope separator slash to double underscore", () => {
		expect(normalizeWorkspaceKey("@org/pkg")).toBe("@org__pkg");
		expect(normalizeWorkspaceKey("@spencerbeggs/vitest-agent-reporter")).toBe("@spencerbeggs__vitest-agent-reporter");
	});

	it("converts every slash, not just the first one", () => {
		expect(normalizeWorkspaceKey("a/b/c")).toBe("a__b__c");
	});

	it("replaces Windows-reserved characters with underscore", () => {
		expect(normalizeWorkspaceKey('foo:bar*baz?qux"a<b>c|d\\e')).toBe("foo_bar_baz_qux_a_b_c_d_e");
	});

	it("replaces whitespace with underscore", () => {
		expect(normalizeWorkspaceKey("foo bar\tbaz\nqux")).toBe("foo_bar_baz_qux");
	});

	it("collapses 3+ underscores into double underscore", () => {
		expect(normalizeWorkspaceKey("a___b")).toBe("a__b");
		expect(normalizeWorkspaceKey("a______b")).toBe("a__b");
	});

	it("preserves naturally-occurring double underscores", () => {
		expect(normalizeWorkspaceKey("a__b")).toBe("a__b");
	});

	it("returns empty string for empty input", () => {
		expect(normalizeWorkspaceKey("")).toBe("");
	});

	it("is deterministic: same input always produces same output", () => {
		const inputs = ["@org/pkg", "my-app", "foo bar", "@a/b/c"];
		for (const input of inputs) {
			expect(normalizeWorkspaceKey(input)).toBe(normalizeWorkspaceKey(input));
		}
	});
});

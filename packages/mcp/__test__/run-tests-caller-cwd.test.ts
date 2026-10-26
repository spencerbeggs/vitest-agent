/**
 * `isWorktreeMismatch` (issue #275): the pure comparison behind the
 * `run_tests` wrong-worktree refusal. Only a PRESENT caller identity that
 * shares the root's git common dir but has a different toplevel is a
 * mismatch; anything indeterminate (`null`) means "cannot tell" and never
 * refuses.
 */

import { describe, expect, it } from "vitest";
import { isWorktreeMismatch } from "../src/tools/run-tests.js";

const tree = (toplevel: string, commonDir = "/repo/.git") => ({ toplevel, commonDir });

describe("isWorktreeMismatch", () => {
	it("should report a mismatch when the trees share a common dir but differ in toplevel", () => {
		expect(isWorktreeMismatch(tree("/repo-wt"), tree("/repo"))).toBe(true);
	});

	it("should not report a mismatch when both resolve to the same toplevel", () => {
		expect(isWorktreeMismatch(tree("/repo"), tree("/repo"))).toBe(false);
	});

	it("should not report a mismatch for a different repository", () => {
		expect(isWorktreeMismatch(tree("/other", "/other/.git"), tree("/repo"))).toBe(false);
	});

	it("should not report a mismatch when the caller identity is unknown", () => {
		expect(isWorktreeMismatch(null, tree("/repo"))).toBe(false);
	});

	it("should not report a mismatch when the root identity is unknown", () => {
		expect(isWorktreeMismatch(tree("/repo-wt"), null)).toBe(false);
	});
});

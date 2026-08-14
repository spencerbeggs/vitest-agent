/**
 * `shouldExitOnUncaughtException` (issue #191, sub-item A).
 *
 * Node's own guidance for `uncaughtException` is "do not resume normal
 * operation" because arbitrary in-process state may be corrupt — but a
 * long-running MCP server that exits on every uncaught exception
 * reproduces exactly the failure this issue reports (the stdio
 * transport dies, deregistering every tool from the client). The
 * judgment call this pure function encodes: before the transport is
 * connected there is no client session to preserve, so failing fast is
 * strictly better than spinning forever in a half-initialized state;
 * once it is connected, keeping the process alive preserves every
 * *other* in-flight and future tool call, which this package holds no
 * long-lived mutable state (outside SQLite's own transactions) that a
 * stray exception could leave corrupted.
 */

import { describe, expect, it } from "vitest";
import { shouldExitOnUncaughtException } from "../src/utils/crash-guards.js";

describe("shouldExitOnUncaughtException", () => {
	it("returns true before the transport has connected", () => {
		expect(shouldExitOnUncaughtException(false)).toBe(true);
	});

	it("returns false once the transport has connected", () => {
		expect(shouldExitOnUncaughtException(true)).toBe(false);
	});
});

/**
 * `agent record run-workspace-changes` decodes its files-json argument with a
 * Schema at parse time: well-formed input is recorded, and a malformed array or
 * an unknown `changeKind` is a usage error (exit 64, nothing on stdout) before
 * anything reaches the database. The post-commit hook ignores the exit code.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "../utils/cli-test.js";
import { openSession } from "../utils/cli-test.js";

let session: CliSession;
let workspaceDir: string;

beforeEach(async () => {
	session = await openSession();
	workspaceDir = join(session.sandbox.root, "workspace");
	mkdirSync(workspaceDir);
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "workspace-changes-fixture" }), "utf-8");
});

afterEach(() => session.close());

const record = (filesJson: string) =>
	session.run(["agent", "record", "run-workspace-changes", "--sha", "abc123", "--project", "p", filesJson], {
		cwd: workspaceDir,
	});

describe("agent record run-workspace-changes files-json", () => {
	it("records a well-formed changed-files array", async () => {
		const result = await record(JSON.stringify([{ filePath: "src/a.ts", changeKind: "modified" }]));

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).not.toBe("");
	});

	it("rejects an unknown changeKind as a usage error", async () => {
		const result = await record(JSON.stringify([{ filePath: "src/a.ts", changeKind: "exploded" }]));

		expect(result.exitCode).toBe(64);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("exploded");
	});

	it("rejects text that is not JSON as a usage error", async () => {
		const result = await record("{not json");

		expect(result.exitCode).toBe(64);
		expect(result.stdout).toBe("");
	});
});

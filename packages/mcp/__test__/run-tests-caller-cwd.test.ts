/**
 * `checkCallerWorktree` (issue #275): the `run_tests` wrong-worktree refusal,
 * over `@effected/git`'s `Git.treeIdentity` and `TreeIdentity.relation`. Only
 * a PRESENT pair of identities in the same repository but different working
 * trees refuses; anything indeterminate (absent, relative, nonexistent, not a
 * directory, outside git) or a different repository proceeds. Real git repos
 * and a linked worktree, because the relation is git's answer, not ours.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkCallerWorktree } from "../src/tools/run-tests.js";

const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "vitest-agent-test",
	GIT_AUTHOR_EMAIL: "test@vitest-agent.dev",
	GIT_COMMITTER_NAME: "vitest-agent-test",
	GIT_COMMITTER_EMAIL: "test@vitest-agent.dev",
};

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "ignore" });

describe("checkCallerWorktree", () => {
	let tmpRoot: string;
	let main: string;
	let sibling: string;
	let other: string;

	beforeAll(() => {
		// Physical paths: git answers physical paths, and the refusal names them.
		tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "va-caller-worktree-")));
		main = join(tmpRoot, "main");
		sibling = join(tmpRoot, "sibling");
		other = join(tmpRoot, "other");
		mkdirSync(main);
		mkdirSync(other);
		git(main, "init", "--quiet");
		git(main, "commit", "--allow-empty", "--quiet", "-m", "init");
		git(main, "worktree", "add", "--quiet", "-b", "side", sibling);
		mkdirSync(join(main, "pkg"));
		git(other, "init", "--quiet");
		git(other, "commit", "--allow-empty", "--quiet", "-m", "init");
		writeFileSync(join(tmpRoot, "a-file"), "");
	});

	afterAll(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("should refuse a caller in a sibling worktree, naming both trees and the projectRoot to pass", async () => {
		const result = await checkCallerWorktree(sibling, main);
		expect(result).toEqual({
			ok: false,
			message: `This call came from the working tree "${sibling}" but the Vitest root resolved to "${main}", a different working tree of the same repository, so the run would report results for the wrong tree. Pass projectRoot (the absolute path of your own working tree, "${sibling}") to run there.`,
		});
	});

	it("should proceed for a caller in a subdirectory of the same tree", async () => {
		expect(await checkCallerWorktree(join(main, "pkg"), main)).toEqual({ ok: true, root: main });
	});

	it("should proceed for a caller in a different repository", async () => {
		expect(await checkCallerWorktree(other, main)).toEqual({ ok: true, root: main });
	});

	it("should proceed for a caller outside any repository", async () => {
		const outside = realpathSync(mkdtempSync(join(tmpdir(), "va-caller-outside-")));
		try {
			expect(await checkCallerWorktree(outside, main)).toEqual({ ok: true, root: main });
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it.each([
		["absent", undefined],
		["empty", ""],
		["relative", "sibling"],
	])("should proceed for an %s caller directory", async (_label, callerCwd) => {
		expect(await checkCallerWorktree(callerCwd, main)).toEqual({ ok: true, root: main });
	});

	it("should proceed for a caller directory that does not exist or is a file", async () => {
		expect(await checkCallerWorktree(join(tmpRoot, "missing"), main)).toEqual({ ok: true, root: main });
		expect(await checkCallerWorktree(join(tmpRoot, "a-file"), main)).toEqual({ ok: true, root: main });
	});
});

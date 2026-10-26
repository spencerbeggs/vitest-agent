import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunContextLive } from "../src/layers/RunContextLive.js";
import { RunContextService } from "../src/services/RunContext.js";

/**
 * Real git in a temp directory: what `RunContextLive` persists into
 * `test_runs.git_*` / the agent start columns must stay byte-identical
 * across the move onto `@effected/git`, including the detached-HEAD
 * literal `"HEAD"` and the swallow-to-null policy.
 */
const git = (cwd: string, ...args: ReadonlyArray<string>) =>
	execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();

const live = RunContextLive({}).pipe(Layer.provide(NodeServices.layer));

const capture = (cwd: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const svc = yield* RunContextService;
			return { run: yield* svc.captureRunContext(cwd), agent: yield* svc.captureAgentContext(cwd) };
		}).pipe(Effect.provide(live)),
	);

let dir: string;
beforeEach(() => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "va-runctx-")));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const initRepo = (cwd: string) => {
	git(cwd, "init", "-q", "-b", "main");
	git(cwd, "config", "user.email", "t@example.com");
	git(cwd, "config", "user.name", "t");
	git(cwd, "config", "commit.gpgsign", "false");
};

const commit = (cwd: string, file: string) => {
	writeFileSync(join(cwd, file), file);
	git(cwd, "add", file);
	git(cwd, "commit", "-q", "-m", file);
	return git(cwd, "rev-parse", "HEAD");
};

describe("RunContextLive (real git)", () => {
	// The pre-kit capture recorded `gitDirty: null` for a clean tree (empty
	// porcelain output folded to "no answer"); a clean tree is `false`.
	it("captures branch, sha, clean state and toplevel on an attached branch", async () => {
		initRepo(dir);
		const sha = commit(dir, "a.txt");
		const { run, agent } = await capture(dir);
		expect({
			branch: run.gitBranch,
			sha: run.gitCommitSha,
			dirty: run.gitDirty,
			upstream: run.gitUpstream,
			worktree: run.gitWorktreeDir,
		}).toEqual({ branch: "main", sha, dirty: false, upstream: null, worktree: dir });
		expect({
			branch: agent.startGitBranch,
			sha: agent.startGitCommitSha,
			worktree: agent.startWorktreeDir,
		}).toEqual({ branch: "main", sha, worktree: dir });
	});

	it("reports dirty for an untracked file, and the toplevel from a subdirectory", async () => {
		initRepo(dir);
		commit(dir, "a.txt");
		writeFileSync(join(dir, "untracked.txt"), "x");
		execFileSync("mkdir", [join(dir, "sub")]);
		const { run } = await capture(join(dir, "sub"));
		expect(run.gitDirty).toBe(true);
		expect(run.gitWorktreeDir).toBe(dir);
	});

	it("reports dirty for a modified tracked file", async () => {
		initRepo(dir);
		commit(dir, "a.txt");
		writeFileSync(join(dir, "a.txt"), "changed");
		const { run } = await capture(dir);
		expect(run.gitDirty).toBe(true);
	});

	it("stores the literal HEAD as the branch on a detached HEAD", async () => {
		initRepo(dir);
		const first = commit(dir, "a.txt");
		commit(dir, "b.txt");
		git(dir, "checkout", "-q", "--detach", first);
		const { run, agent } = await capture(dir);
		expect(run.gitBranch).toBe("HEAD");
		expect(run.gitCommitSha).toBe(first);
		expect(agent.startGitBranch).toBe("HEAD");
	});

	it("captures the upstream when the branch tracks one", async () => {
		const remote = join(dir, "remote");
		const clone = join(dir, "clone");
		execFileSync("mkdir", [remote]);
		initRepo(remote);
		commit(remote, "a.txt");
		execFileSync("git", ["clone", "-q", remote, clone], { stdio: "ignore" });
		const { run } = await capture(clone);
		expect(run.gitUpstream).toBe("origin/main");
		expect(run.gitBranch).toBe("main");
	});

	it("folds every git failure to null outside a repository", async () => {
		const { run, agent } = await capture(dir);
		expect({
			branch: run.gitBranch,
			sha: run.gitCommitSha,
			dirty: run.gitDirty,
			upstream: run.gitUpstream,
			worktree: run.gitWorktreeDir,
		}).toEqual({ branch: null, sha: null, dirty: null, upstream: null, worktree: null });
		expect({
			branch: agent.startGitBranch,
			sha: agent.startGitCommitSha,
			worktree: agent.startWorktreeDir,
		}).toEqual({ branch: null, sha: null, worktree: null });
	});

	// The pre-kit capture recorded branch "HEAD" and sha "HEAD" here: git echoes
	// the argument on stdout before failing, and the exit code was ignored.
	it("an unborn repository (no commits) records no branch and no sha", async () => {
		initRepo(dir);
		const { run } = await capture(dir);
		expect({
			branch: run.gitBranch,
			sha: run.gitCommitSha,
			dirty: run.gitDirty,
			worktree: run.gitWorktreeDir,
		}).toEqual({ branch: null, sha: null, dirty: false, worktree: dir });
	});
});

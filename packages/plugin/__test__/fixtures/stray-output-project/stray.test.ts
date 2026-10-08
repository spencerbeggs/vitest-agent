import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

// A child process with inherited stdio writes straight to the worker's own
// stderr, past Vitest's console capture: the `git worktree add` shape.
test("spawns a child that writes to the terminal", () => {
	const child = spawnSync(process.execPath, ["-e", "process.stderr.write('STRAY-LINE from child\\n')"], {
		stdio: "inherit",
	});
	expect(child.status).toBe(0);
});

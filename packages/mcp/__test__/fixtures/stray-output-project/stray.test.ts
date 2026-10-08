import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

// A child process with inherited stdio writes straight to the worker's own
// stdout and stderr, past Vitest's console capture.
test("spawns a child that writes to the terminal", () => {
	const child = spawnSync(
		process.execPath,
		["-e", "process.stdout.write('STRAY-STDOUT from child\\n'); process.stderr.write('STRAY-STDERR from child\\n')"],
		{ stdio: "inherit" },
	);
	expect(child.status).toBe(0);
});

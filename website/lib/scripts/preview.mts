import type { ChildProcess } from "node:child_process";
import { execSync, spawn } from "node:child_process";
import open from "open";

const PORT = 4173;

function killProcessOnPort(port: number): void {
	try {
		const result = execSync(`lsof -ti:${port}`, { encoding: "utf-8" });
		const pids = result.trim().split("\n").filter(Boolean);
		for (const pid of pids) {
			process.kill(Number(pid), "SIGTERM");
		}
		if (pids.length > 0) {
			console.log(`Killed process(es) on port ${port}: ${pids.join(", ")}`);
		}
	} catch {
		// No process on port — continue
	}
}

killProcessOnPort(PORT);

const shouldOpenBrowser = !process.env.NO_OPEN;

const child: ChildProcess = spawn("pnpm", ["rspress", "preview", "--port", String(PORT)], {
	stdio: ["inherit", "pipe", "pipe"],
	env: { ...process.env, FORCE_COLOR: "1" },
});

const waitForReady: Promise<void> = new Promise<void>((resolve) => {
	let resolved = false;

	const handleOutput = (data: Buffer): void => {
		const output = data.toString();
		process.stdout.write(data);

		if (!resolved && output.includes("to show shortcuts")) {
			console.log("\n✅ Server ready, opening browser...");
			resolved = true;
			resolve();
		}
	};

	child.stdout?.on("data", handleOutput);
	child.stderr?.on("data", handleOutput);
});

child.on("error", (error) => {
	console.error("Failed to start preview server:", error);
	process.exit(1);
});

child.on("exit", (code) => {
	console.log("Rspress preview server exited");
	process.exit(code ?? 0);
});

try {
	await waitForReady;
	if (shouldOpenBrowser) {
		await open(`http://localhost:${PORT}/guide`);
		console.log("✅ Browser opened successfully");
	} else {
		console.log("✅ Server ready (browser opening disabled via NO_OPEN)");
	}
} catch (error) {
	console.error("Failed to open browser:", error);
}

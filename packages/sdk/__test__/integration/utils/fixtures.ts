import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedRuntime } from "effect";
import { test as base } from "vitest";
import { makeTestLayer } from "../../utils/layers.js";

export const test = base
	// biome-ignore lint/correctness/noEmptyPattern: Vitest file-scoped fixture requires a destructuring parameter
	.extend("tmpDir", { scope: "file" }, async ({}, { onCleanup }) => {
		const dir = mkdtempSync(join(tmpdir(), "va-sdk-int-"));
		onCleanup(() => rmSync(dir, { recursive: true, force: true }));
		return dir;
	})
	.extend("runtime", { scope: "file" }, async ({ tmpDir }, { onCleanup }) => {
		const rt = ManagedRuntime.make(makeTestLayer(join(tmpDir, "data.db")));
		onCleanup(() => rt.dispose());
		return rt;
	});

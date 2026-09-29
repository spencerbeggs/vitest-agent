import { ManagedRuntime } from "effect";
import { test as base } from "vitest";
import { makeTestLayer } from "../../utils/layers.js";

export const test = base
	// One in-memory database per file: the file-scoped runtime holds the single
	// SQLite connection for the whole file, so every test in it shares state
	// exactly as it did against a tmpdir file. Nothing reopens the database.
	// biome-ignore lint/correctness/noEmptyPattern: Vitest file-scoped fixture requires a destructuring parameter
	.extend("runtime", { scope: "file" }, async ({}, { onCleanup }) => {
		const rt = ManagedRuntime.make(makeTestLayer(":memory:"));
		onCleanup(() => rt.dispose());
		return rt;
	});

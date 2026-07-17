import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DataReader, DataStore, OutputRenderer, ProjectDiscovery } from "@vitest-agent/sdk";
import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { makeTestLayer } from "@vitest-agent/sdk/testing";
import { Layer, ManagedRuntime } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import { test as base } from "vitest";

// Superset of McpContext.runtime — adds SqlClient so tests can do raw SQL
// assertions while the cast to McpContext["runtime"] still works for the caller.
// Uses only well-structured package imports so tsgo can name the type.
type McpRuntime = ManagedRuntime.ManagedRuntime<
	DataReader | DataStore | ProjectDiscovery | OutputRenderer | typeof SqlClient.Service,
	never
>;

export const test = base
	// biome-ignore lint/correctness/noEmptyPattern: Vitest file-scoped fixture requires a destructuring parameter
	.extend("tmpDir", { scope: "file" }, async ({}, { onCleanup }): Promise<string> => {
		const dir = mkdtempSync(join(tmpdir(), "va-mcp-int-"));
		onCleanup(() => rmSync(dir, { recursive: true, force: true }));
		return dir;
	})
	.extend("runtime", { scope: "file" }, async ({ tmpDir }, { onCleanup }): Promise<McpRuntime> => {
		const McpTestLayer = Layer.mergeAll(
			makeTestLayer(join(tmpDir, "data.db")),
			OutputPipelineLive,
			ProjectDiscoveryTest.layer([]),
		);
		const rt = ManagedRuntime.make(McpTestLayer);
		onCleanup(() => rt.dispose());
		return rt as unknown as McpRuntime;
	});

import { resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DependencyGraph, WorkspaceDiscovery, Workspaces } from "@effected/workspaces";
import { LayerEdge, LayerPolicy, WorkspaceLayering } from "@effected/workspaces/testing";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer));
const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof Live>>) =>
	Effect.runPromise(effect.pipe(Effect.provide(Live)));

/**
 * Holds the workspace graph to the committed root `layers.json` (#412's
 * ranked layering): plugin (the carrier) over cli + mcp (one layer, so
 * neither may depend on the other) over engine / reporter / sidecar over
 * ui + the four sidecar-* platform packages over sdk. The policy checks the
 * runtime fields only; devDependency cycles are caught separately below.
 * The private root, `docs` and `playground` are unconstrained; the
 * claude-code-plugin tracking package is tooling.
 */
describe("workspace layering (#412)", () => {
	it("the live package graph honours layers.json, non-vacuously", async () => {
		const report = await run(
			Effect.gen(function* () {
				const policy = yield* LayerPolicy.load(resolve(ROOT, "layers.json"));
				return yield* WorkspaceLayering.checkWorkspace(policy);
			}),
		);
		expect(report.violations).toEqual([]);
		expect(report.edgeCount).toBeGreaterThan(0);
	});

	it("the graph is acyclic across every dependency field, devDependencies included", async () => {
		const graph = await run(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				return DependencyGraph.make({ packages: yield* discovery.listPackages() });
			}),
		);
		expect(graph.names.length).toBeGreaterThan(1);
		expect(graph.hasCycle).toBe(false);
	});

	it("an upward edge and a cli -> mcp edge are violations (positive control)", async () => {
		// Synthetic edges the live graph never has: sdk (bottom) reaching the
		// engine above it, and one front end depending on the other.
		const policy = await Effect.runPromise(
			LayerPolicy.decode({
				layers: [["@vitest-agent/cli", "@vitest-agent/mcp"], ["@vitest-agent/engine"], ["@vitest-agent/sdk"]],
				tooling: [],
				unconstrained: [],
			}),
		);
		const graph = {
			names: ["@vitest-agent/cli", "@vitest-agent/mcp", "@vitest-agent/engine", "@vitest-agent/sdk"],
			edges: [
				LayerEdge.make({ from: "@vitest-agent/engine", to: "@vitest-agent/sdk", field: "dependencies" }),
				LayerEdge.make({ from: "@vitest-agent/sdk", to: "@vitest-agent/engine", field: "dependencies" }),
				LayerEdge.make({ from: "@vitest-agent/cli", to: "@vitest-agent/mcp", field: "dependencies" }),
			],
		};
		const report = WorkspaceLayering.check(graph, policy);
		expect(report.offenders.map(({ edge, reason }) => `${reason}: ${edge.from} -> ${edge.to}`)).toEqual([
			"upward: @vitest-agent/sdk -> @vitest-agent/engine",
			"sameLayer: @vitest-agent/cli -> @vitest-agent/mcp",
		]);
	});
});

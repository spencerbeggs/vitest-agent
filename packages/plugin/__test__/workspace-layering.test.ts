import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LAYER_RANKS, readWorkspaceGraph } from "./utils/workspace-graph.js";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const graph = readWorkspaceGraph(ROOT);

describe("workspace layering (#412)", () => {
	it("every workspace package has a declared rank", () => {
		const missing = graph.map((n) => n.name).filter((n) => !(n in LAYER_RANKS));
		expect(missing).toEqual([]);
	});

	it("every workspace edge points to a strictly lower rank", () => {
		const violations = graph.flatMap((n) =>
			n.edges.filter((e) => LAYER_RANKS[e.to] >= LAYER_RANKS[n.name]).map((e) => `${n.name} -> ${e.to} (${e.kind})`),
		);
		expect(violations).toEqual([]);
	});

	it("the two front ends never depend on each other", () => {
		const cli = graph.find((n) => n.name === "@vitest-agent/cli");
		const mcp = graph.find((n) => n.name === "@vitest-agent/mcp");
		expect(cli?.edges.map((e) => e.to)).not.toContain("@vitest-agent/mcp");
		expect(mcp?.edges.map((e) => e.to)).not.toContain("@vitest-agent/cli");
	});

	it("the graph is a DAG (topological sort consumes every node)", () => {
		const indeg = new Map(graph.map((n) => [n.name, 0]));
		for (const n of graph) for (const e of n.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
		const queue = graph.filter((n) => indeg.get(n.name) === 0).map((n) => n.name);
		const seen: string[] = [];
		while (queue.length > 0) {
			const name = queue.shift() as string;
			seen.push(name);
			for (const e of graph.find((n) => n.name === name)?.edges ?? []) {
				indeg.set(e.to, (indeg.get(e.to) ?? 0) - 1);
				if (indeg.get(e.to) === 0) queue.push(e.to);
			}
		}
		expect(seen.length).toBe(graph.length);
	});
});

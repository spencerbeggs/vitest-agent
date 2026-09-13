import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface WorkspaceEdge {
	readonly to: string;
	readonly kind: "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
}
export interface WorkspaceNode {
	readonly name: string;
	readonly dir: string;
	readonly edges: ReadonlyArray<WorkspaceEdge>;
}

const KINDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

const readManifest = (dir: string) =>
	JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown> & {
		name: string;
	};

export const readWorkspaceGraph = (rootDir: string): ReadonlyArray<WorkspaceNode> => {
	const dirs = [
		rootDir,
		...readdirSync(join(rootDir, "packages"), { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => join(rootDir, "packages", e.name)),
		...readdirSync(join(rootDir, "plugins"), { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => join(rootDir, "plugins", e.name)),
		join(rootDir, "website"),
		join(rootDir, "playground"),
	].filter((d) => existsSync(join(d, "package.json")));
	const manifests = dirs.map((dir) => ({ dir, pkg: readManifest(dir) }));
	const names = new Set(manifests.map((m) => m.pkg.name));
	return manifests.map(({ dir, pkg }) => ({
		name: pkg.name,
		dir,
		edges: KINDS.flatMap((kind) =>
			Object.keys((pkg[kind] as Record<string, string> | undefined) ?? {})
				.filter((to) => names.has(to))
				.map((to) => ({ to, kind })),
		),
	}));
};

/** Declared layering (#412). Every workspace edge must point to a strictly lower rank. */
export const LAYER_RANKS: Record<string, number> = {
	"@vitest-agent/sdk": 1,
	"@vitest-agent/ui": 2,
	"@vitest-agent/sidecar-darwin-arm64": 2,
	"@vitest-agent/sidecar-linux-arm64": 2,
	"@vitest-agent/sidecar-linux-x64": 2,
	"@vitest-agent/sidecar-win32-x64": 2,
	"@vitest-agent/engine": 3,
	"@vitest-agent/reporter": 3,
	"@vitest-agent/sidecar": 3,
	"@vitest-agent/cli": 4,
	"@vitest-agent/mcp": 4,
	"@vitest-agent/plugin": 5,
	"@vitest-agent/claude-code-plugin": 6,
	docs: 6,
	playground: 6,
	"vitest-agent": 7,
};

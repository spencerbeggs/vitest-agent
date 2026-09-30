import * as path from "node:path";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { DiscoverProjectsOptions, DiscoverProjectsResult } from "../../src/utils/discover-projects.js";
import { discoverProjects } from "../../src/utils/discover-projects.js";
import type { WalkerFileSystem } from "../../src/utils/walker-fs.js";
import { memfsWalkerFs } from "./memfs-walker.js";

/**
 * A seeded `@effected/memfs` volume presented through both ports discovery
 * reads — the async {@link WalkerFileSystem} and the sync
 * `@effected/workspaces` ops — plus `write` for mutating the tree between
 * calls, so a whole `discoverProjects` scenario runs without touching disk.
 */
export interface MemfsWorkspace {
	/** Absolute root the seed was placed under. */
	readonly root: string;
	readonly fs: WalkerFileSystem;
	readonly syncOps: NonNullable<DiscoverProjectsOptions["syncOps"]>;
	/** Writes `content` at `relPath` under `root`, creating parent directories. */
	readonly write: (relPath: string, content?: string) => void;
	/** Runs `discoverProjects` over this volume, `cwd` defaulting to `root`. */
	readonly discover: (options?: Omit<DiscoverProjectsOptions, "fs" | "syncOps">) => Promise<DiscoverProjectsResult>;
}

// `discoverProjects` keeps a process-level result cache keyed by workspace
// root. Real tmpdirs were unique per test for free; virtual roots must be made
// unique on purpose, or two tests seeding the same tree would share a cache
// entry (identical paths and seed-time mtimes produce identical signatures).
let rootCounter = 0;

/** A fresh, never-reused absolute root such as `/ws-7/repo`. */
export const uniqueRoot = (name = "repo"): string => `/ws-${++rootCounter}/${name}`;

/**
 * Seeds a volume from `seed` (paths relative to a fresh unique root) and
 * returns the {@link MemfsWorkspace} over it.
 */
export const makeMemfsWorkspace = (seed: MemoryFileSystemSeed, root: string = uniqueRoot()): MemfsWorkspace => {
	const handle = MemoryFileSystem.makeSync(seed, { root });
	const fs = memfsWalkerFs(handle);
	const syncOps = { fileSystem: handle.sync, path };
	return {
		root,
		fs,
		syncOps,
		write: (relPath, content = "") => handle.write(relPath, content),
		discover: (options) => discoverProjects({ cwd: root, ...options, fs, syncOps }),
	};
};

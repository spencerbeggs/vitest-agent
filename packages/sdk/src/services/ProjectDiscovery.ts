import type { Effect } from "effect";
import { Context } from "effect";
import type { DiscoveryError } from "../errors/DiscoveryError.js";
/** @public */
export interface TestFileEntry {
	readonly testFile: string;
	readonly sourceFiles: ReadonlyArray<string>;
}
/** @public */
export class ProjectDiscovery extends Context.Tag("vitest-agent/ProjectDiscovery")<
	ProjectDiscovery,
	{
		readonly discoverTestFiles: (rootDir: string) => Effect.Effect<ReadonlyArray<TestFileEntry>, DiscoveryError>;
		readonly mapTestToSource: (testFile: string) => Effect.Effect<ReadonlyArray<string>, DiscoveryError>;
	}
>() {}

import type { DiscoveryError } from "@vitest-agent/sdk";
import type { Effect } from "effect";
import { Context } from "effect";
/** @public */
export interface TestFileEntry {
	readonly testFile: string;
	readonly sourceFiles: ReadonlyArray<string>;
}
/** @public */
export class ProjectDiscovery extends Context.Service<
	ProjectDiscovery,
	{
		readonly discoverTestFiles: (rootDir: string) => Effect.Effect<ReadonlyArray<TestFileEntry>, DiscoveryError>;
		readonly mapTestToSource: (testFile: string) => Effect.Effect<ReadonlyArray<string>, DiscoveryError>;
	}
>()("vitest-agent/ProjectDiscovery") {}

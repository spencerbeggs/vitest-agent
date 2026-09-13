import { Effect, Layer } from "effect";
import type { TestFileEntry } from "../services/ProjectDiscovery.js";
import { ProjectDiscovery } from "../services/ProjectDiscovery.js";
/** @public */
export const ProjectDiscoveryTest = {
	layer: (entries: ReadonlyArray<TestFileEntry>): Layer.Layer<ProjectDiscovery> =>
		Layer.succeed(ProjectDiscovery, {
			discoverTestFiles: () => Effect.succeed(entries),
			mapTestToSource: (testFile) => Effect.succeed(entries.find((e) => e.testFile === testFile)?.sourceFiles ?? []),
		}),
} as const;

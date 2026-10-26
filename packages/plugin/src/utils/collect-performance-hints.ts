/**
 * Builds Vitest's performance-hint inputs from a Vitest instance and maps the
 * resulting diagnostics onto `PerformanceHint`s. Input gathering, gating, and
 * the printed wording follow vitest@5.0.5 packages/vitest/src/node/reporters/
 * base.ts (`onFinished` and the four `report*Diagnostic` methods), with ANSI,
 * project labels, and summary padding removed. Re-check on every Vitest bump.
 *
 * @packageDocumentation
 */

import type { PerformanceHint } from "@vitest-agent/sdk";
import type {
	EnvironmentDiagnosticInput,
	ImportDiagnosticInput,
	TransformDiagnosticInput,
} from "./vitest-diagnostics.js";
import {
	formatTime,
	getEnvironmentDiagnostics,
	getImportDiagnostics,
	getIsolateDiagnostic,
	getTransformDiagnostics,
} from "./vitest-diagnostics.js";

/**
 * Options for {@link collectPerformanceHints}.
 * @internal
 */
export interface CollectPerformanceHintsOptions {
	/**
	 * Whether the run is on CI. Vitest reads `isCI` from `std-env`; the plugin
	 * has no such helper, so the caller (which already reads the environment)
	 * passes it. Defaults to `false`.
	 */
	readonly isCI?: boolean;
}

const LEARN_MORE = {
	environment: "https://vitest.dev/guide/improving-performance#test-environments",
	import: "https://vitest.dev/guide/improving-performance#test-isolation",
	transform: "https://vitest.dev/guide/improving-performance#caching-between-reruns",
	// Vitest prints no URL for the isolate hint; the schema needs one, so it
	// points at the same `isolate: false` section the import hint uses.
	isolate: "https://vitest.dev/guide/improving-performance#test-isolation",
} as const;

// Structural views of the Vitest objects read here. Every field is optional:
// the collector reads them defensively and an unknown shape yields no hints.
interface FileLike {
	projectName?: string;
	environmentLoad?: number;
	setupDuration?: number;
	collectDuration?: number;
	collectFetchDuration?: number;
	setupFetchDuration?: number;
	prepareDuration?: number;
	result?: { duration?: number };
	importDurations?: Record<string, { selfTime: number }>;
}

interface ProjectConfigLike {
	environment?: string;
	pool?: string;
	isolate?: boolean;
	browser?: { enabled?: boolean };
	providedOptions?: { pool?: unknown; isolate?: unknown; fsModuleCache?: unknown };
	fsModuleCache?: unknown;
}

interface ProjectLike {
	name?: string;
	config?: ProjectConfigLike;
}

interface VitestLike {
	config?: {
		watch?: boolean;
		maxWorkers?: number;
		experimental?: {
			diagnostics?: { environment?: boolean; import?: boolean; transform?: boolean; isolate?: boolean };
			importDurations?: { limit?: number };
		};
	};
	projects?: ReadonlyArray<ProjectLike>;
	state?: {
		getFiles?: () => ReadonlyArray<FileLike>;
		blobs?: unknown;
		metadata?: Record<string, { duration?: Record<string, number[]> } | undefined>;
		workersSpawned?: number;
		startupTime?: number;
	};
}

/**
 * Summed time of all tracked phases of a file (base.ts `trackedFileTime`).
 * The transform wait is part of `setupDuration`/`collectDuration`, so it is
 * not added separately.
 */
const trackedFileTime = (file: FileLike): number =>
	(file.environmentLoad || 0) +
	(file.setupDuration || 0) +
	(file.collectDuration || 0) +
	(file.prepareDuration || 0) +
	(file.result?.duration || 0);

const pct = (share: number): number => Math.round(share * 100);

const projectFilesOf = (files: ReadonlyArray<FileLike>, name: string): FileLike[] =>
	files.filter((file) => (file.projectName || "") === name);

const nameOf = (project: ProjectLike): string => project.name ?? "";

const withProject = (name: string): { project?: string } => (name ? { project: name } : {});

function environmentHints(
	vitest: VitestLike,
	projects: ReadonlyArray<ProjectLike>,
	files: ReadonlyArray<FileLike>,
	executionTime: number,
): PerformanceHint[] {
	const maxWorkers = vitest.config?.maxWorkers ?? 1;
	const inputs: EnvironmentDiagnosticInput[] = projects.map((project) => {
		const name = nameOf(project);
		const config = project.config ?? {};
		let environmentTime = 0;
		let environmentCount = 0;
		let trackedTime = 0;
		for (const file of projectFilesOf(files, name)) {
			if (file.environmentLoad) {
				environmentTime += file.environmentLoad;
				environmentCount++;
			}
			trackedTime += trackedFileTime(file);
		}
		return {
			name,
			environment: config.environment ?? "",
			pool: config.pool ?? "",
			isolate: config.isolate === true,
			browser: config.browser?.enabled === true,
			poolProvided: Boolean(config.providedOptions?.pool),
			isolateProvided: Boolean(config.providedOptions?.isolate),
			environmentTime,
			environmentCount,
			trackedTime,
			parallelism: Math.max(1, Math.min(environmentCount, maxWorkers)),
			executionTime,
		};
	});
	return getEnvironmentDiagnostics(inputs).map((d) => ({
		kind: "environment",
		...withProject(d.name),
		message: `${d.environment} was created ${d.environmentCount} times · ${formatTime(d.environmentTime)} total, ${pct(d.share)}% of tracked time`,
		remedy: "pool: 'vmThreads'",
		detail: d.suggestIsolate
			? "create it once per worker (keeps per-file isolation) or isolate: false (shares it across files)"
			: "create it once per worker (keeps per-file isolation)",
		learnMoreUrl: LEARN_MORE.environment,
		share: d.share,
	}));
}

function importHints(
	vitest: VitestLike,
	projects: ReadonlyArray<ProjectLike>,
	files: ReadonlyArray<FileLike>,
	executionTime: number,
): PerformanceHint[] {
	const maxWorkers = vitest.config?.maxWorkers ?? 1;
	const metadata = vitest.state?.metadata ?? {};
	const inputs: ImportDiagnosticInput[] = projects.map((project) => {
		const name = nameOf(project);
		const config = project.config ?? {};
		const projectFiles = projectFilesOf(files, name);
		let importTime = 0;
		let trackedTime = 0;
		for (const file of projectFiles) {
			// the transform wait is subtracted because `isolate: false` only avoids
			// re-evaluating modules, the server transforms each of them once either way
			importTime += Math.max((file.collectDuration || 0) - (file.collectFetchDuration || 0), 0);
			trackedTime += trackedFileTime(file);
		}
		const durations = metadata[name]?.duration;
		return {
			name,
			pool: config.pool ?? "",
			isolate: config.isolate === true,
			browser: config.browser?.enabled === true,
			isolateProvided: Boolean(config.providedOptions?.isolate),
			importTime,
			trackedTime,
			fetchCounts: durations ? Object.values(durations).map((times) => times.length) : [],
			fileCount: projectFiles.length,
			parallelism: Math.max(1, Math.min(projectFiles.length, maxWorkers)),
			executionTime,
		};
	});
	return getImportDiagnostics(inputs).map((d) => ({
		kind: "import",
		...withProject(d.name),
		message: `${d.uniqueModules} modules were evaluated ${d.totalFetches} times · ${formatTime(d.importTime)} total, ${pct(d.share)}% of tracked time`,
		remedy: "isolate: false",
		detail: `~${formatTime(d.estimatedSaving)} faster — shared modules are evaluated once per worker instead of once per file`,
		learnMoreUrl: LEARN_MORE.import,
		estimatedSavingMs: d.estimatedSaving,
		share: d.share,
	}));
}

function transformHints(
	projects: ReadonlyArray<ProjectLike>,
	files: ReadonlyArray<FileLike>,
	executionTime: number,
	isCI: boolean,
): PerformanceHint[] {
	const inputs: TransformDiagnosticInput[] = projects.map((project) => {
		const name = nameOf(project);
		const config = project.config ?? {};
		let transformTime = 0;
		let trackedTime = 0;
		for (const file of projectFilesOf(files, name)) {
			transformTime += (file.setupFetchDuration || 0) + (file.collectFetchDuration || 0);
			trackedTime += trackedFileTime(file);
		}
		return {
			name,
			transformTime,
			trackedTime,
			fsModuleCache: config.fsModuleCache === true,
			fsModuleCacheProvided: Boolean(config.providedOptions?.fsModuleCache),
			executionTime,
		};
	});
	return getTransformDiagnostics(inputs).map((d) => ({
		kind: "transform",
		...withProject(d.name),
		message: `transforming modules took ${formatTime(d.transformTime)} · ${pct(d.share)}% of tracked time, re-done on every run`,
		remedy: "fsModuleCache: true",
		detail: isCI
			? "persist transforms across runs; on CI this only helps when the cache directory is persisted between runs"
			: "persist transforms across runs",
		learnMoreUrl: LEARN_MORE.transform,
		share: d.share,
	}));
}

function isolateHint(
	vitest: VitestLike,
	projects: ReadonlyArray<ProjectLike>,
	files: ReadonlyArray<FileLike>,
	executionTime: number,
): PerformanceHint | undefined {
	const config = vitest.config ?? {};
	// only meaningful when at least one non-browser project isolates workers
	// without the user having explicitly chosen isolation
	const isEligible = (project: ProjectLike): boolean =>
		project.config?.isolate === true &&
		project.config.browser?.enabled !== true &&
		!project.config.providedOptions?.isolate;

	const measuresModules = (config.experimental?.importDurations?.limit ?? 0) > 0;
	const moduleSelfTimes = new Map<string, number[]>();
	if (measuresModules) {
		// vm pools re-create the module graph per VM context regardless of
		// `isolate`, so only files of `forks`/`threads` projects count
		const eligibleProjects = new Set(
			projects
				.filter(
					(project) => (project.config?.pool === "forks" || project.config?.pool === "threads") && isEligible(project),
				)
				.map(nameOf),
		);
		for (const file of files) {
			if (!eligibleProjects.has(file.projectName || "") || !file.importDurations) {
				continue;
			}
			for (const moduleId in file.importDurations) {
				let times = moduleSelfTimes.get(moduleId);
				if (!times) {
					times = [];
					moduleSelfTimes.set(moduleId, times);
				}
				times.push(file.importDurations[moduleId]?.selfTime ?? 0);
			}
		}
	}

	const d = getIsolateDiagnostic({
		numWorkers: vitest.state?.workersSpawned ?? 0,
		isolates: projects.some(isEligible),
		numFiles: files.length,
		startupTime: vitest.state?.startupTime ?? 0,
		maxWorkers: config.maxWorkers ?? 1,
		measuresModules,
		moduleSelfTimes: moduleSelfTimes.values(),
		executionTime,
	});
	if (d === undefined) return undefined;
	return {
		kind: "isolate",
		message: `${d.numWorkers} workers spawned · ~${formatTime(d.avgStartup)} startup each (spawn + environment, per file)`,
		remedy: "isolate: false",
		detail: `${d.measuresModules ? "" : "at least "}~${formatTime(d.estimatedSaving)} faster — ${
			d.measuresModules
				? "reuses workers across files and evaluates shared modules once per worker"
				: "reuses workers across files instead of one per file"
		}`,
		learnMoreUrl: LEARN_MORE.isolate,
		estimatedSavingMs: d.estimatedSaving,
	};
}

/**
 * Compute the performance hints Vitest's `BaseReporter` would print at the
 * end of a run, for runs where `AgentPlugin` stripped that reporter. Applies
 * Vitest's gating (watch mode, merged blob reports, and each kind's
 * `experimental.diagnostics` flag) and its one-hint-per-family order:
 * environment, else import, else transform; isolate only when none of those
 * produced a hint. Never throws; an unrecognized `vitest` shape yields `[]`.
 *
 * @param vitest - The Vitest instance (read structurally)
 * @param executionTimeMs - Wall time of the run, in milliseconds
 * @param options - See {@link CollectPerformanceHintsOptions}
 * @internal
 */
export function collectPerformanceHints(
	vitest: object,
	executionTimeMs: number,
	options: CollectPerformanceHintsOptions = {},
): ReadonlyArray<PerformanceHint> {
	try {
		const v = vitest as VitestLike;
		const config = v.config;
		if (config === undefined || config === null || typeof config !== "object" || config.watch) {
			return [];
		}
		const projects = Array.isArray(v.projects) ? v.projects : [];
		const getFiles = v.state?.getFiles;
		const files = typeof getFiles === "function" ? (getFiles.call(v.state) ?? []) : [];
		const diagnostics = config.experimental?.diagnostics ?? {};

		// merged blob reports replay durations of past runs: no environments,
		// imports, or transforms happened in this process
		if (!v.state?.blobs) {
			const familyHints = diagnostics.environment ? environmentHints(v, projects, files, executionTimeMs) : [];
			if (familyHints.length > 0) return familyHints;
			const imports = diagnostics.import ? importHints(v, projects, files, executionTimeMs) : [];
			if (imports.length > 0) return imports;
			const transforms = diagnostics.transform
				? transformHints(projects, files, executionTimeMs, options.isCI === true)
				: [];
			if (transforms.length > 0) return transforms;
		}

		if (!diagnostics.isolate) return [];
		const isolate = isolateHint(v, projects, files, executionTimeMs);
		return isolate === undefined ? [] : [isolate];
	} catch {
		return [];
	}
}

import { describe, expect, it } from "vitest";
import { collectPerformanceHints } from "../src/utils/collect-performance-hints.js";

interface FakeFile {
	projectName: string;
	environmentLoad?: number;
	setupDuration?: number;
	collectDuration?: number;
	collectFetchDuration?: number;
	setupFetchDuration?: number;
	prepareDuration?: number;
	result?: { duration?: number };
	importDurations?: Record<string, { selfTime: number }>;
}

const allDiagnostics = { environment: true, import: true, transform: true, isolate: true };

interface FakeOptions {
	files?: FakeFile[];
	environment?: string;
	diagnostics?: Partial<typeof allDiagnostics>;
	watch?: boolean;
	blobs?: unknown;
	workersSpawned?: number;
	startupTime?: number;
	fsModuleCache?: boolean;
}

// the barrel-file shape from Vitest's import-diagnostics test: 20 files that
// each re-evaluate the same 800-module graph. importTime 20 x 750ms = 15s,
// trackedTime 20 x (750 + 250)ms = 20s, parallelism min(20, 8) = 8.
const barrelFiles = (): FakeFile[] =>
	Array.from({ length: 20 }, () => ({ projectName: "barrel", collectDuration: 750, result: { duration: 250 } }));

const fakeVitest = (o: FakeOptions = {}) => ({
	config: {
		watch: o.watch ?? false,
		maxWorkers: 8,
		experimental: {
			diagnostics: { ...allDiagnostics, ...o.diagnostics },
			importDurations: { limit: 0 },
		},
	},
	projects: [
		{
			name: "barrel",
			config: {
				environment: o.environment ?? "node",
				pool: "forks",
				isolate: true,
				browser: { enabled: false },
				providedOptions: {},
				fsModuleCache: o.fsModuleCache ?? false,
			},
		},
	],
	state: {
		getFiles: () => o.files ?? barrelFiles(),
		blobs: o.blobs,
		metadata: {
			barrel: {
				duration: Object.fromEntries(
					Array.from({ length: 800 }, (_, i) => [`/m${i}.ts`, Array.from({ length: 20 }, () => 1)]),
				),
			},
		},
		workersSpawned: o.workersSpawned ?? 0,
		startupTime: o.startupTime ?? 0,
	},
});

describe("collectPerformanceHints", () => {
	it("maps an import-heavy run to exactly one import hint with its project", () => {
		expect(collectPerformanceHints(fakeVitest(), 4_000)).toEqual([
			{
				kind: "import",
				project: "barrel",
				message: "800 modules were evaluated 16000 times · 15.00s total, 75% of tracked time",
				remedy: "isolate: false",
				detail: "~1.13s faster — shared modules are evaluated once per worker instead of once per file",
				learnMoreUrl: "https://vitest.dev/guide/improving-performance#test-isolation",
				estimatedSavingMs: 1_125,
				share: 0.75,
			},
		]);
	});

	it("returns [] in watch mode", () => {
		expect(
			collectPerformanceHints(fakeVitest({ watch: true, workersSpawned: 20, startupTime: 40_000 }), 4_000),
		).toEqual([]);
	});

	it("suppresses environment, import and transform hints for merged blob reports", () => {
		const hints = collectPerformanceHints(fakeVitest({ blobs: { executionTimes: [4_000] } }), 4_000);
		expect(hints.filter((h) => h.kind !== "isolate")).toEqual([]);
	});

	it("still evaluates the isolate hint for merged blob reports (Vitest gates isolate on watch only)", () => {
		const hints = collectPerformanceHints(
			fakeVitest({ blobs: { executionTimes: [4_000] }, workersSpawned: 20, startupTime: 40_000 }),
			4_000,
		);
		expect(hints.map((h) => h.kind)).toEqual(["isolate"]);
	});

	it("returns [] when the kind's experimental.diagnostics flag is false", () => {
		expect(collectPerformanceHints(fakeVitest({ diagnostics: { import: false } }), 4_000)).toEqual([]);
	});

	it("prefers the environment hint over the import hint (one per family)", () => {
		// 20 jsdom setups x 1.5s = 30s; trackedTime 20 x (1500 + 750 + 250) = 50s
		const files = barrelFiles().map((f) => ({ ...f, environmentLoad: 1_500 }));
		const hints = collectPerformanceHints(fakeVitest({ files, environment: "jsdom" }), 10_000);
		expect(hints).toEqual([
			{
				kind: "environment",
				project: "barrel",
				message: "jsdom was created 20 times · 30.00s total, 60% of tracked time",
				remedy: "pool: 'vmThreads'",
				detail: "create it once per worker (keeps per-file isolation) or isolate: false (shares it across files)",
				learnMoreUrl: "https://vitest.dev/guide/improving-performance#test-environments",
				share: 0.6,
			},
		]);
	});

	it("emits the transform hint only when no environment or import hint applies", () => {
		// 20 files x 500ms fetch wait; importTime = collect - fetch = 0
		const files = Array.from({ length: 20 }, () => ({
			projectName: "barrel",
			collectDuration: 500,
			collectFetchDuration: 500,
			result: { duration: 500 },
		}));
		expect(collectPerformanceHints(fakeVitest({ files }), 10_000)).toEqual([
			{
				kind: "transform",
				project: "barrel",
				message: "transforming modules took 10.00s · 50% of tracked time, re-done on every run",
				remedy: "fsModuleCache: true",
				detail: "persist transforms across runs",
				learnMoreUrl: "https://vitest.dev/guide/improving-performance#caching-between-reruns",
				share: 0.5,
			},
		]);
	});

	it("appends the CI caveat to the transform hint on CI", () => {
		const files = Array.from({ length: 20 }, () => ({
			projectName: "barrel",
			collectDuration: 500,
			collectFetchDuration: 500,
			result: { duration: 500 },
		}));
		const [hint] = collectPerformanceHints(fakeVitest({ files }), 10_000, { isCI: true });
		expect(hint?.detail).toBe(
			"persist transforms across runs; on CI this only helps when the cache directory is persisted between runs",
		);
	});

	it("emits a project-less isolate hint when no family hint applies", () => {
		// 20 workers, 20 small files, parallelism 8: avg 2s, wall 5s, saving 3s
		const files = Array.from({ length: 20 }, () => ({ projectName: "barrel", result: { duration: 10 } }));
		expect(collectPerformanceHints(fakeVitest({ files, workersSpawned: 20, startupTime: 40_000 }), 10_000)).toEqual([
			{
				kind: "isolate",
				message: "20 workers spawned · ~2.00s startup each (spawn + environment, per file)",
				remedy: "isolate: false",
				detail: "at least ~3.00s faster — reuses workers across files instead of one per file",
				learnMoreUrl: "https://vitest.dev/guide/improving-performance#test-isolation",
				estimatedSavingMs: 3_000,
			},
		]);
	});

	it("returns [] (no throw) for an unknown shape", () => {
		expect(collectPerformanceHints({}, 4_000)).toEqual([]);
	});

	it("returns [] (no throw) when reading the state throws", () => {
		const vitest = {
			...fakeVitest(),
			state: {
				getFiles: () => {
					throw new Error("boom");
				},
			},
		};
		expect(collectPerformanceHints(vitest, 4_000)).toEqual([]);
	});
});

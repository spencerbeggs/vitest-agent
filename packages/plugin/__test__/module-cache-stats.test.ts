import { MemoryFileSystem } from "@effected/memfs";
import { describe, expect, it } from "vitest";
import { countModulesWritten } from "../src/utils/module-cache-stats.js";
import { seedMemfsWalker } from "./utils/memfs-walker.js";

const KEY_A = "a".repeat(40);
const KEY_B = "b".repeat(40);
const KEY_C = "c".repeat(40);

const APP = { name: "app", root: "/repo/app" };
const manifest = (name: string, root: string, keys: string[]): string =>
	JSON.stringify({
		name,
		root,
		modules: { node: Object.fromEntries(keys.map((k, i) => [`/m${i}.ts`, k])) },
		externalized: {},
	});

describe("countModulesWritten", () => {
	it("should count only cache entries modified at or after the run start", () => {
		// Given: a cache directory with two fresh entries and one from an earlier run
		const ops = seedMemfsWalker("/cache", {
			[KEY_A]: MemoryFileSystem.file("fresh", { mtime: 5_000 }),
			[KEY_B]: MemoryFileSystem.file("fresh-at-start", { mtime: 4_000 }),
			[KEY_C]: MemoryFileSystem.file("stale", { mtime: 3_999 }),
			"_manifest-app-1.json": MemoryFileSystem.file(manifest("app", "/repo/app", [KEY_A, KEY_B, KEY_C]), {
				mtime: 5_000,
			}),
		});

		// When: counting what the run wrote
		const written = countModulesWritten("/cache", 4_000, APP, ops);

		// Then: only the two entries at or after the start are counted
		expect(written).toBe(2);
	});

	it("should ignore the metadata, manifest and tag files that are not module entries", () => {
		const ops = seedMemfsWalker("/cache", {
			[KEY_A]: MemoryFileSystem.file("fresh", { mtime: 5_000 }),
			"_metadata.json": MemoryFileSystem.file("{}", { mtime: 5_000 }),
			"_manifest-app-123.json": MemoryFileSystem.file(manifest("app", "/repo/app", [KEY_A]), { mtime: 5_000 }),
			"CACHEDIR.TAG": MemoryFileSystem.file("Signature", { mtime: 5_000 }),
		});
		expect(countModulesWritten("/cache", 4_000, APP, ops)).toBe(1);
	});

	it("should answer undefined when the cache directory does not exist", () => {
		const ops = seedMemfsWalker("/cache", {});
		expect(countModulesWritten("/cache/missing", 0, APP, ops)).toBeUndefined();
	});

	it("should count only the entries its own manifest lists when projects share the cache", () => {
		// Given: two projects whose manifests list different fresh entries
		const ops = seedMemfsWalker("/cache", {
			[KEY_A]: MemoryFileSystem.file("x", { mtime: 5_000 }),
			[KEY_B]: MemoryFileSystem.file("x", { mtime: 5_000 }),
			[KEY_C]: MemoryFileSystem.file("x", { mtime: 5_000 }),
			"_manifest-app-1.json": MemoryFileSystem.file(manifest("app", "/repo/app", [KEY_A]), { mtime: 5_000 }),
			"_manifest-lib-2.json": MemoryFileSystem.file(manifest("lib", "/repo/lib", [KEY_B, KEY_C]), { mtime: 5_000 }),
		});

		// When / Then: each project counts its own
		expect(countModulesWritten("/cache", 4_000, APP, ops)).toBe(1);
		expect(countModulesWritten("/cache", 4_000, { name: "lib", root: "/repo/lib" }, ops)).toBe(2);
	});

	it("should count a module key listed by two projects for both", () => {
		const ops = seedMemfsWalker("/cache", {
			[KEY_A]: MemoryFileSystem.file("x", { mtime: 5_000 }),
			"_manifest-app-1.json": MemoryFileSystem.file(manifest("app", "/repo/app", [KEY_A]), { mtime: 5_000 }),
			"_manifest-lib-2.json": MemoryFileSystem.file(manifest("lib", "/repo/lib", [KEY_A]), { mtime: 5_000 }),
		});
		expect(countModulesWritten("/cache", 4_000, APP, ops)).toBe(1);
		expect(countModulesWritten("/cache", 4_000, { name: "lib", root: "/repo/lib" }, ops)).toBe(1);
	});

	it("should answer 0 when no manifest matches the project", () => {
		const ops = seedMemfsWalker("/cache", {
			[KEY_A]: MemoryFileSystem.file("x", { mtime: 5_000 }),
			"_manifest-lib-2.json": MemoryFileSystem.file(manifest("lib", "/repo/lib", [KEY_A]), { mtime: 5_000 }),
		});
		expect(countModulesWritten("/cache", 4_000, APP, ops)).toBe(0);
	});

	it("should ignore a manifest with malformed JSON or shape", () => {
		const ops = seedMemfsWalker("/cache", {
			[KEY_A]: MemoryFileSystem.file("x", { mtime: 5_000 }),
			"_manifest-bad-1.json": MemoryFileSystem.file("{not json", { mtime: 5_000 }),
			"_manifest-bad-2.json": MemoryFileSystem.file(JSON.stringify({ name: "app", root: "/repo/app", modules: 7 }), {
				mtime: 5_000,
			}),
			"_manifest-bad-3.json": MemoryFileSystem.file("null", { mtime: 5_000 }),
		});
		expect(countModulesWritten("/cache", 4_000, APP, ops)).toBe(0);
	});
});

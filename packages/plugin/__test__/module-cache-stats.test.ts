import { MemoryFileSystem } from "@effected/memfs";
import { describe, expect, it } from "vitest";
import { countModulesWritten } from "../src/utils/module-cache-stats.js";
import { seedMemfsWalker } from "./utils/memfs-walker.js";

const KEY_A = "a".repeat(40);
const KEY_B = "b".repeat(40);
const KEY_C = "c".repeat(40);

describe("countModulesWritten", () => {
	it("should count only cache entries modified at or after the run start", () => {
		// Given: a cache directory with two fresh entries and one from an earlier run
		const ops = seedMemfsWalker("/cache", {
			[KEY_A]: MemoryFileSystem.file("fresh", { mtime: 5_000 }),
			[KEY_B]: MemoryFileSystem.file("fresh-at-start", { mtime: 4_000 }),
			[KEY_C]: MemoryFileSystem.file("stale", { mtime: 3_999 }),
		});

		// When: counting what the run wrote
		const written = countModulesWritten("/cache", 4_000, ops);

		// Then: only the two entries at or after the start are counted
		expect(written).toBe(2);
	});

	it("should ignore the metadata, manifest and tag files that are not module entries", () => {
		const ops = seedMemfsWalker("/cache", {
			[KEY_A]: MemoryFileSystem.file("fresh", { mtime: 5_000 }),
			"_metadata.json": MemoryFileSystem.file("{}", { mtime: 5_000 }),
			"_manifest-app-123.json": MemoryFileSystem.file("{}", { mtime: 5_000 }),
			"CACHEDIR.TAG": MemoryFileSystem.file("Signature", { mtime: 5_000 }),
		});
		expect(countModulesWritten("/cache", 4_000, ops)).toBe(1);
	});

	it("should answer undefined when the cache directory does not exist", () => {
		const ops = seedMemfsWalker("/cache", {});
		expect(countModulesWritten("/cache/missing", 0, ops)).toBeUndefined();
	});
});

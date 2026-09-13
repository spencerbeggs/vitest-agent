import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROJECT_MIGRATIONS } from "../src/migrations/index.js";

const migrationsDir = fileURLToPath(new URL("../src/migrations/", import.meta.url));

describe("PROJECT_MIGRATIONS", () => {
	it("registers exactly the numbered migration files on disk", () => {
		const onDisk = readdirSync(migrationsDir)
			.filter((name) => /^0\d+_.+\.ts$/.test(name))
			.map((name) => name.replace(/\.ts$/, ""))
			.sort();

		expect(Object.keys(PROJECT_MIGRATIONS).sort()).toStrictEqual(onDisk);
	});

	it("orders its keys ascending so the migrator applies them in sequence", () => {
		const keys = Object.keys(PROJECT_MIGRATIONS);
		expect(keys).toStrictEqual([...keys].sort());
	});
});

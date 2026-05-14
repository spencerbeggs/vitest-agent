#!/usr/bin/env node
/**
 * Hard reset script for all build artifacts.
 * Cleans plugin, modules, and sites so a full rebuild from scratch is possible.
 * Run from root: pnpm reset
 */

import { readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "../..");
let removedCount = 0;

function remove(targetPath: string): void {
	try {
		rmSync(targetPath, { recursive: true, force: true });
		const rel = targetPath.replace(`${rootDir}/`, "");
		console.log(`  removed ${rel}`);
		removedCount++;
	} catch {
		// already gone
	}
}

function getDirs(parentDir: string): string[] {
	try {
		return readdirSync(parentDir).filter((entry) => {
			try {
				return statSync(join(parentDir, entry)).isDirectory();
			} catch {
				return false;
			}
		});
	} catch {
		return [];
	}
}

// --- Packages ---
const packagesDir = join(rootDir, "packages");
for (const pkg of getDirs(packagesDir)) {
	const pkgDir = join(packagesDir, pkg);
	console.log(`\nCleaning packages/${pkg}/`);
	remove(join(pkgDir, "dist"));
	remove(join(pkgDir, ".turbo"));
	remove(join(pkgDir, ".rslib"));
	remove(join(pkgDir, "node_modules"));
}

// --- Root turbo cache ---
console.log("\nCleaning root");
remove(join(rootDir, ".turbo"));
remove(join(rootDir, "coverage"));
remove(join(rootDir, "node_modules"));
remove(join(rootDir, "dist"));

console.log(`\nDone. Removed ${removedCount} items.\n`);

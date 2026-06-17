import { createHash } from "node:crypto";
import type { SettingsInput } from "@vitest-agent/sdk";

export function captureSettings(config: Record<string, unknown>, vitestVersion: string): SettingsInput {
	const pool = config.pool as string | undefined;
	const environment = config.environment as string | undefined;
	const testTimeout = config.testTimeout as number | undefined;
	const hookTimeout = config.hookTimeout as number | undefined;
	const slowTestThreshold = config.slowTestThreshold as number | undefined;
	const maxConcurrency = config.maxConcurrency as number | undefined;
	const maxWorkers = config.maxWorkers as number | undefined;
	const isolate = config.isolate as boolean | undefined;
	const bail = config.bail as number | undefined;
	const globals = config.globals as boolean | undefined;
	const fileParallelism = config.fileParallelism as boolean | undefined;
	const sequenceSeed = (config.sequence as Record<string, unknown>)?.seed as number | undefined;
	const coverageProvider = (config.coverage as Record<string, unknown>)?.provider as string | undefined;

	return {
		vitestVersion: vitestVersion,
		...(pool !== undefined && { pool }),
		...(environment !== undefined && { environment }),
		...(testTimeout !== undefined && { testTimeout: testTimeout }),
		...(hookTimeout !== undefined && { hookTimeout: hookTimeout }),
		...(slowTestThreshold !== undefined && { slowTestThreshold: slowTestThreshold }),
		...(maxConcurrency !== undefined && { maxConcurrency: maxConcurrency }),
		...(maxWorkers !== undefined && { maxWorkers: maxWorkers }),
		...(isolate !== undefined && { isolate }),
		...(bail !== undefined && { bail }),
		...(globals !== undefined && { globals }),
		...(fileParallelism !== undefined && { fileParallelism: fileParallelism }),
		...(sequenceSeed !== undefined && { sequenceSeed: sequenceSeed }),
		...(coverageProvider !== undefined && { coverageProvider: coverageProvider }),
	};
}

export function hashSettings(settings: Record<string, unknown>): string {
	const json = JSON.stringify(settings, Object.keys(settings).sort());
	return createHash("sha256").update(json).digest("hex");
}

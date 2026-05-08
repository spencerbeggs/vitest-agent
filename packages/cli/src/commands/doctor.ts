/**
 * CLI doctor command -- diagnose database health.
 *
 * @packageDocumentation
 */

import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { DataReader, resolveDataPath } from "vitest-agent-sdk";
import type { CheckResult } from "../lib/format-doctor.js";
import { formatDoctor } from "../lib/format-doctor.js";

const formatOption = Options.withDefault(Options.choice("format", ["markdown", "json"]), "markdown");

const writeOutput = (results: CheckResult[], format: string) =>
	Effect.sync(() => {
		if (format === "json") {
			process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
		} else {
			process.stdout.write(`${formatDoctor(results)}\n`);
		}
	});

export const doctorCommand = Command.make("doctor", { format: formatOption }, ({ format }) =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const results: CheckResult[] = [];

		// Check 1: Database path resolves (a function of workspace identity, not file existence)
		const dbPath = yield* resolveDataPath(process.cwd());
		results.push({
			name: "Database path",
			passed: true,
			detail: `\`${dbPath}\``,
		});

		// Check 2: Manifest (can read project data from DB)
		const manifestOpt = yield* reader.getManifest().pipe(Effect.catchAll(() => Effect.succeed(Option.none<never>())));

		if (Option.isNone(manifestOpt)) {
			results.push({
				name: "Manifest",
				passed: false,
				detail: "no test run data found in database",
			});

			yield* writeOutput(results, format);
			yield* Effect.sync(() => process.exit(1));
			return;
		}

		const manifest = manifestOpt.value;
		results.push({
			name: "Manifest valid",
			passed: true,
			detail: `${manifest.projects.length} project${manifest.projects.length !== 1 ? "s" : ""}`,
		});

		// Check 3: Report integrity (can read latest run per project)
		let validReports = 0;
		const reportIssues: string[] = [];
		for (const entry of manifest.projects) {
			const project = entry.project;
			const reportOpt = yield* reader
				.getLatestRun(project)
				.pipe(Effect.catchAll(() => Effect.succeed(Option.none<never>())));

			if (Option.isNone(reportOpt)) {
				reportIssues.push(`\`${entry.project}\` no report data`);
			} else {
				validReports++;
			}
		}

		const totalReports = manifest.projects.length;
		if (reportIssues.length > 0) {
			results.push({
				name: "Reports",
				passed: false,
				detail: `${validReports}/${totalReports} valid -- ${reportIssues.join(", ")}`,
			});
		} else {
			results.push({
				name: "Reports",
				passed: true,
				detail: `${validReports}/${totalReports} valid`,
			});
		}

		// Check 4: History integrity (can read history per project)
		let validHistory = 0;
		let totalHistory = 0;
		const historyIssues: string[] = [];
		for (const entry of manifest.projects) {
			totalHistory++;
			const project = entry.project;
			const history = yield* reader.getHistory(project).pipe(
				Effect.map((h) => ({ ok: true as const, record: h })),
				Effect.catchAll(() => Effect.succeed({ ok: false as const, record: null })),
			);

			if (!history.ok) {
				historyIssues.push(`\`${entry.project}\` history read error`);
			} else {
				validHistory++;
			}
		}

		if (totalHistory > 0) {
			if (historyIssues.length > 0) {
				results.push({
					name: "History",
					passed: false,
					detail: `${validHistory}/${totalHistory} valid -- ${historyIssues.join(", ")}`,
				});
			} else {
				results.push({
					name: "History",
					passed: true,
					detail: `${validHistory}/${totalHistory} valid`,
				});
			}
		}

		// Check 5: Staleness
		const timestamps = manifest.projects.map((e) => e.lastRun).filter((t): t is string => t !== null);

		if (timestamps.length > 0) {
			const latest = new Date(Math.max(...timestamps.map((t) => new Date(t).getTime())));
			const ageMs = Date.now() - latest.getTime();
			const ageMinutes = Math.floor(ageMs / 60_000);
			const ageHours = Math.floor(ageMs / 3_600_000);
			const ageDays = Math.floor(ageMs / 86_400_000);

			let ageStr: string;
			if (ageMinutes < 1) ageStr = "just now";
			else if (ageMinutes < 60) ageStr = `${ageMinutes} minute${ageMinutes !== 1 ? "s" : ""} ago`;
			else if (ageHours < 24) ageStr = `${ageHours} hour${ageHours !== 1 ? "s" : ""} ago`;
			else ageStr = `${ageDays} day${ageDays !== 1 ? "s" : ""} ago`;

			const isStale = ageHours >= 24;
			results.push({
				name: "Last run",
				passed: !isStale,
				detail: isStale ? `${ageStr} (stale)` : ageStr,
			});
		}

		// Output
		yield* writeOutput(results, format);

		const hasFailures = results.some((r) => !r.passed);
		if (hasFailures) {
			yield* Effect.sync(() => process.exit(1));
		}
	}),
);

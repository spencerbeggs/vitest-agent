import { Effect, Option } from "effect";
import { DataReader } from "../services/DataReader.js";
/** @public */
export interface FormatTriageOptions {
	readonly project?: string;
	readonly maxLines?: number;
}

/**
 * Generates an orientation triage markdown string for LLM agents.
 * Summarises recent test runs, active sessions, acceptance metrics,
 * and (forward-compat) the most recent TDD session.
 *
 * Error channel is `never` — all DataReader errors are swallowed and
 * replaced with empty defaults so the caller is guaranteed a string.
 * @public
 */
export const formatTriageEffect = (options: FormatTriageOptions = {}): Effect.Effect<string, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;

		const allProjects = yield* reader.getRunsByProject().pipe(Effect.orElseSucceed(() => [] as const));

		const projects = options.project ? allProjects.filter((p) => p.project === options.project) : allProjects;

		const sessions = yield* reader.listSessions({}).pipe(Effect.orElseSucceed(() => [] as const));

		const fallbackMetrics = {
			phaseEvidenceIntegrity: { total: 0, compliant: 0, ratio: 0 },
			complianceHookResponsiveness: { total: 0, withFollowup: 0, ratio: 0 },
			orientationUsefulness: { total: 0, referencedCount: 0, ratio: 0 },
			antiPatternDetectionRate: { total: 0, cleanSessions: 0, ratio: 0 },
		};

		const metrics = yield* reader.computeAcceptanceMetrics().pipe(Effect.orElseSucceed(() => fallbackMetrics));

		// Forward-compat probe — exercises the consolidated `tdd_task({ action: "get" })` read path.
		const openTddRaw = yield* reader.getTddTaskById(1).pipe(Effect.orElseSucceed(() => Option.none()));

		const lines: string[] = [];

		lines.push("## Vitest Agent Reporter — Orientation Triage");
		lines.push("");

		// --- L2 MCP-tool orientation block ---
		// Action-paired guidance, always present so the SessionStart hook's
		// injected triage lands the orientation surface once per session.
		lines.push("### Available vitest-agent MCP tools (most useful)");
		lines.push("");
		lines.push("- `run_tests` — run Vitest programmatically; returns AgentReport + classifications");
		lines.push("- `test_errors` — failure detail (after a failing run)");
		lines.push("- `test_history` — failure classification series (after recurring failures)");
		lines.push("- `file_coverage` — per-file coverage gaps (after coverage drops)");
		lines.push("- `triage_brief` — orient on the current test landscape");
		lines.push("");

		// --- Projects section ---
		if (projects.length > 0) {
			lines.push("### Recent Test Runs");
			lines.push("");
			for (const p of projects) {
				const status = p.lastResult ?? "unknown";
				const counts = `${p.passed} passed, ${p.failed} failed`;
				lines.push(`- **${p.project}** — ${status} (${counts})`);
			}
			lines.push("");
		} else {
			lines.push("### Recent Test Runs");
			lines.push("");
			lines.push("_No test runs recorded yet._");
			lines.push("");
		}

		// --- Session section ---
		lines.push("### Session Log");
		lines.push("");
		if (sessions.length > 0) {
			for (const s of sessions) {
				const end = s.endedAt ? ` → ended ${s.endedAt}` : " → active";
				lines.push(`- session \`${s.chatId}\` (${s.agentKind}) started ${s.startedAt}${end}`);
			}
		} else {
			lines.push("_No session data recorded yet._");
		}
		lines.push("");

		// --- Acceptance metrics section ---
		lines.push("### Acceptance Metrics");
		lines.push("");
		const pct = (r: number) => `${(r * 100).toFixed(0)}%`;
		lines.push(
			`- Phase evidence integrity: ${pct(metrics.phaseEvidenceIntegrity.ratio)} (${metrics.phaseEvidenceIntegrity.compliant}/${metrics.phaseEvidenceIntegrity.total})`,
		);
		lines.push(
			`- Compliance hook responsiveness: ${pct(metrics.complianceHookResponsiveness.ratio)} (${metrics.complianceHookResponsiveness.withFollowup}/${metrics.complianceHookResponsiveness.total})`,
		);
		lines.push(
			`- Orientation usefulness: ${pct(metrics.orientationUsefulness.ratio)} (${metrics.orientationUsefulness.referencedCount}/${metrics.orientationUsefulness.total})`,
		);
		lines.push(
			`- Anti-pattern detection: ${pct(metrics.antiPatternDetectionRate.ratio)} (${metrics.antiPatternDetectionRate.cleanSessions}/${metrics.antiPatternDetectionRate.total})`,
		);
		lines.push("");

		// Forward-compat: surface open TDD session when present.
		if (Option.isSome(openTddRaw)) {
			const tdd = openTddRaw.value;
			lines.push("### Open TDD Session");
			lines.push("");
			lines.push(`- Goal: ${tdd.goal}`);
			lines.push(`- Started: ${tdd.startedAt}`);
			lines.push(`- Phases recorded: ${tdd.phases.length}`);
			lines.push("");
		}

		const out = lines.join("\n");
		if (options.maxLines !== undefined) {
			const arr = out.split("\n");
			if (arr.length > options.maxLines) {
				return arr.slice(0, options.maxLines).join("\n");
			}
		}
		return out;
	});

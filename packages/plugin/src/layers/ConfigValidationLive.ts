/**
 * Live implementation of the ConfigValidation service.
 *
 * Implements the eight built-in validation rules.
 * Rules run inside `validate(...)` — no I/O at construction time.
 *
 * @packageDocumentation
 */

import { createRequire } from "node:module";
import { validateCoverageTargetsShape } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import type {
	ValidationError,
	ValidationInput,
	ValidationResult,
	ValidationWarning,
} from "../services/ConfigValidation.js";
import { ConfigValidation } from "../services/ConfigValidation.js";
import { resolveThresholds } from "../utils/resolve-thresholds.js";

/** Metrics that can appear at the top level in both coverageTargets and coverage.thresholds. */
const COVERAGE_METRICS = ["lines", "functions", "branches", "statements"] as const;

/** Supported provider package names mapped to their npm package. */
const SUPPORTED_PROVIDERS: Record<string, string> = {
	v8: "@vitest/coverage-v8",
	istanbul: "@vitest/coverage-istanbul",
};

/**
 * Resolves the operating mode from the vitest config.
 * Full mode when coverage.enabled !== false; UI-only otherwise.
 */
function resolveMode(vitestConfig: ValidationInput["vitestConfig"]): "full" | "ui-only" {
	const coverageCfg = vitestConfig.coverage as { enabled?: boolean } | undefined;
	return coverageCfg?.enabled === false ? "ui-only" : "full";
}

/**
 * Try to require-resolve a package from the workspace.
 * Returns true when the package is resolvable, false when it is not installed.
 */
function isPackageInstalled(packageName: string): boolean {
	try {
		const require = createRequire(import.meta.url);
		require.resolve(packageName);
		return true;
	} catch {
		return false;
	}
}

/**
 * Run the TARGET_WITHOUT_THRESHOLD and TARGET_BELOW_THRESHOLD rules.
 *
 * Both targets and thresholds run through resolveThresholds so the `100: true`
 * shorthand and glob-pattern entries are expanded into the canonical `global`
 * per-metric numeric form before comparison. Without normalization a config
 * like `coverage.thresholds: { 100: true }` would look "unset" per metric and
 * fire false-positive TARGET_WITHOUT_THRESHOLD warnings.
 *
 * One entry per affected metric.
 */
function runTargetThresholdRules(
	input: ValidationInput,
	errors: ValidationError[],
	warnings: ValidationWarning[],
): void {
	const rawTargets = input.pluginOptions.coverageTargets as Record<string, unknown> | undefined;
	if (!rawTargets) return;

	const coverageCfg = input.vitestConfig.coverage as { thresholds?: Record<string, unknown> } | undefined;
	const targets = resolveThresholds(rawTargets).global;
	const thresholds = resolveThresholds(coverageCfg?.thresholds).global;

	for (const metric of COVERAGE_METRICS) {
		const targetValue = targets[metric];
		const thresholdValue = thresholds[metric];

		if (typeof targetValue !== "number") continue;

		if (thresholdValue === undefined) {
			// TARGET_WITHOUT_THRESHOLD: target set, threshold not set
			warnings.push({
				code: "TARGET_WITHOUT_THRESHOLD",
				message: `coverageTargets.${metric} is set to ${targetValue} but coverage.thresholds.${metric} is not configured. Set coverage.thresholds.${metric} to enforce a minimum coverage floor.`,
			});
		} else if (targetValue < thresholdValue) {
			// TARGET_BELOW_THRESHOLD: target is below the threshold
			errors.push({
				code: "TARGET_BELOW_THRESHOLD",
				message: `coverageTargets.${metric} (${targetValue}) is below coverage.thresholds.${metric} (${thresholdValue}). The target must be at or above the threshold for ${metric}.`,
			});
		}
		// THRESHOLD_WITHOUT_TARGET: threshold set, target unset — silent, emit nothing.
	}
}

/**
 * Run the INVALID_TARGET_VALUE rule by delegating to the SDK helper.
 * Also picks up PERFILE_ON_TARGETS from the same walk.
 */
function runInvalidTargetValueRule(
	input: ValidationInput,
	errors: ValidationError[],
	warnings: ValidationWarning[],
): void {
	const targets = input.pluginOptions.coverageTargets;
	if (!targets) return;

	const result = validateCoverageTargetsShape(targets);

	for (const err of result.errors) {
		errors.push({
			code: err.code,
			path: err.path,
			message: err.message,
		});
	}

	for (const warn of result.warnings) {
		if (warn.code === "PERFILE_ON_TARGETS") {
			warnings.push({
				code: "PERFILE_ON_TARGETS",
				message: `A top-level "perFile" key should not be set inside coverageTargets. Set coverage.thresholds.perFile instead, or move it inside a glob-pattern entry — under Vitest 5 a glob-pattern entry carries its own perFile and no longer inherits the top-level one.`,
			});
		}
	}
}

/**
 * Run the UNSUPPORTED_PROVIDER rule (Full mode only).
 */
function runUnsupportedProviderRule(input: ValidationInput, errors: ValidationError[]): void {
	const coverageCfg = input.vitestConfig.coverage as { provider?: string } | undefined;
	const provider = coverageCfg?.provider;

	// undefined provider is fine — Vitest's default kicks in
	if (provider === undefined) return;

	if (!Object.hasOwn(SUPPORTED_PROVIDERS, provider)) {
		errors.push({
			code: "UNSUPPORTED_PROVIDER",
			message: `coverage.provider "${provider}" is not supported by vitest-agent. Supported providers: v8, istanbul.`,
		});
	}
}

/**
 * Run the MISSING_PROVIDER_PACKAGE rule (Full mode only).
 */
function runMissingProviderPackageRule(input: ValidationInput, errors: ValidationError[]): void {
	const coverageCfg = input.vitestConfig.coverage as { provider?: string } | undefined;
	const provider = coverageCfg?.provider;

	// Only check when provider is explicitly one of the supported ones
	if (provider === undefined) return;
	if (!Object.hasOwn(SUPPORTED_PROVIDERS, provider)) return;

	const packageName = SUPPORTED_PROVIDERS[provider];
	if (!isPackageInstalled(packageName)) {
		errors.push({
			code: "MISSING_PROVIDER_PACKAGE",
			message: `The coverage provider "${provider}" requires the "${packageName}" package, which does not appear to be installed.`,
			remediation: `npm install --save-dev ${packageName}`,
		});
	}
}

/**
 * Run the GITHUB_JOB_SUMMARY_COLLISION rule.
 *
 * Vitest 5's `github-actions` reporter writes a markdown job summary by
 * default, and Vitest seeds the reporter from `configDefaults` under
 * `GITHUB_ACTIONS=true`. The plugin normalizes every such entry to
 * `jobSummary.enabled = false` in `configureVitest`, so a bare string or a
 * tuple with no `jobSummary` key is NOT a collision. Only an explicit
 * `jobSummary: { enabled: true }` survives normalization, and that entry
 * collides with the plugin's own step summary under `ci-github`. Runs in
 * both operating modes — it is a reporter concern, not a coverage concern.
 */
function runGithubJobSummaryCollisionRule(input: ValidationInput, warnings: ValidationWarning[]): void {
	const reporters = (input.vitestConfig as { reporters?: unknown }).reporters;
	if (!Array.isArray(reporters)) return;

	const collides = reporters.some((entry) => {
		if (!Array.isArray(entry) || entry[0] !== "github-actions") return false;
		const options = entry[1] as { jobSummary?: { enabled?: boolean } } | undefined;
		return options?.jobSummary?.enabled === true;
	});
	if (!collides) return;

	warnings.push({
		code: "GITHUB_JOB_SUMMARY_COLLISION",
		path: "reporters",
		message:
			'You enabled the Vitest job summary explicitly on the "github-actions" reporter, and vitest-agent also writes a GitHub Actions step summary. Both summaries will appear in the same job.',
		remediation:
			'Drop the explicit jobSummary option so the plugin can set { jobSummary: { enabled: false } } for you, or set console.ci to "silent" to suppress the plugin\'s own summary instead.',
	});
}

/**
 * Core validation logic. Runs all rules and accumulates results.
 */
function runAllRules(input: ValidationInput): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];
	const info: ValidationResult["info"] = [];

	const mode = resolveMode(input.vitestConfig);

	// Rules that run in both modes
	runTargetThresholdRules(input, errors, warnings);
	runInvalidTargetValueRule(input, errors, warnings);
	runGithubJobSummaryCollisionRule(input, warnings);

	// Rules that run in Full mode only
	if (mode === "full") {
		runUnsupportedProviderRule(input, errors);
		runMissingProviderPackageRule(input, errors);
	}

	return { errors, warnings, info };
}

/**
 * Live implementation of the ConfigValidation service running the built-in rule registry.
 * @public
 */
export const ConfigValidationLive: Layer.Layer<ConfigValidation> = Layer.succeed(ConfigValidation, {
	validate: (input) => Effect.sync(() => runAllRules(input)),
});

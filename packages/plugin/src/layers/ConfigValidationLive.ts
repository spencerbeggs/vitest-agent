/**
 * Live implementation of the ConfigValidation service.
 *
 * Implements all seven validation rules from the 2.0 starter rule set.
 * Rules run inside `validate(...)` — no I/O at construction time.
 *
 * @packageDocumentation
 */

import { createRequire } from "node:module";
import { Effect, Layer } from "effect";
import { validateCoverageTargetsShape } from "vitest-agent-sdk";
import type {
	ValidationError,
	ValidationInput,
	ValidationResult,
	ValidationWarning,
} from "../services/ConfigValidation.js";
import { ConfigValidation } from "../services/ConfigValidation.js";

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
 * One entry per affected metric.
 */
function runTargetThresholdRules(
	input: ValidationInput,
	errors: ValidationError[],
	warnings: ValidationWarning[],
): void {
	const targets = input.pluginOptions.coverageTargets as Record<string, unknown> | undefined;
	const coverageCfg = input.vitestConfig.coverage as { thresholds?: Record<string, unknown> } | undefined;
	const thresholds = coverageCfg?.thresholds ?? {};

	if (!targets) return;

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
		} else if (typeof thresholdValue === "number" && targetValue < thresholdValue) {
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
				message: `The "perFile" key should not be set inside coverageTargets. Set coverage.thresholds.perFile instead.`,
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

	// Rules that run in Full mode only
	if (mode === "full") {
		runUnsupportedProviderRule(input, errors);
		runMissingProviderPackageRule(input, errors);
	}

	return { errors, warnings, info };
}

export const ConfigValidationLive: Layer.Layer<ConfigValidation> = Layer.succeed(ConfigValidation, {
	validate: (input) => Effect.sync(() => runAllRules(input)),
});

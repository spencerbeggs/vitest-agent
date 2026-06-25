import type { AgentPluginOptions } from "@vitest-agent/sdk";
import type { Effect } from "effect";
import { Context } from "effect";
import type { ResolvedConfig } from "vitest/node";

/**
 * A validation error produced by the ConfigValidation service.
 * @public
 */
export interface ValidationError {
	readonly code: string;
	readonly path?: string;
	readonly message: string;
	readonly remediation?: string;
}
/**
 * A validation warning produced by the ConfigValidation service.
 * @public
 */
export interface ValidationWarning {
	readonly code: string;
	readonly path?: string;
	readonly message: string;
	readonly remediation?: string;
}
/**
 * An informational message produced by the ConfigValidation service.
 * @public
 */
export interface ValidationInfo {
	readonly code: string;
	readonly message: string;
}

/**
 * The aggregated result of a ConfigValidation run.
 * @public
 */
export interface ValidationResult {
	readonly errors: ReadonlyArray<ValidationError>;
	readonly warnings: ReadonlyArray<ValidationWarning>;
	readonly info: ReadonlyArray<ValidationInfo>;
}

/**
 * Input consumed by `ConfigValidation.validate`.
 * @public
 */
export interface ValidationInput {
	readonly vitestConfig: ResolvedConfig;
	readonly pluginOptions: AgentPluginOptions;
}

/**
 * Effect service for validating Vitest + plugin coverage configuration.
 * @public
 */
export class ConfigValidation extends Context.Tag("vitest-agent/ConfigValidation")<
	ConfigValidation,
	{
		readonly validate: (input: ValidationInput) => Effect.Effect<ValidationResult, never, never>;
	}
>() {}

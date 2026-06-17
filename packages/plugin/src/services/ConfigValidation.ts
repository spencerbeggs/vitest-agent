import type { AgentPluginOptions } from "@vitest-agent/sdk";
import type { Effect } from "effect";
import { Context } from "effect";
import type { ResolvedConfig } from "vitest/node";

export interface ValidationError {
	readonly code: string;
	readonly path?: string;
	readonly message: string;
	readonly remediation?: string;
}
export interface ValidationWarning {
	readonly code: string;
	readonly path?: string;
	readonly message: string;
	readonly remediation?: string;
}
export interface ValidationInfo {
	readonly code: string;
	readonly message: string;
}

export interface ValidationResult {
	readonly errors: ReadonlyArray<ValidationError>;
	readonly warnings: ReadonlyArray<ValidationWarning>;
	readonly info: ReadonlyArray<ValidationInfo>;
}

export interface ValidationInput {
	readonly vitestConfig: ResolvedConfig;
	readonly pluginOptions: AgentPluginOptions;
}

export class ConfigValidation extends Context.Tag("vitest-agent/ConfigValidation")<
	ConfigValidation,
	{
		readonly validate: (input: ValidationInput) => Effect.Effect<ValidationResult, never, never>;
	}
>() {}

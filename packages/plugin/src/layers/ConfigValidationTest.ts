import { Effect, Layer } from "effect";
import type { ValidationResult } from "../services/ConfigValidation.js";
import { ConfigValidation } from "../services/ConfigValidation.js";

/**
 * Test-double layer factory for ConfigValidation. Pass a pre-built `ValidationResult` to inject.
 * @public
 */
export const ConfigValidationTest = {
	layer: (override?: ValidationResult): Layer.Layer<ConfigValidation> =>
		Layer.succeed(ConfigValidation, {
			validate: () => Effect.succeed(override ?? { errors: [], warnings: [], info: [] }),
		}),
} as const;

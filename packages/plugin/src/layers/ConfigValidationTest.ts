import { Effect, Layer } from "effect";
import type { ValidationResult } from "../services/ConfigValidation.js";
import { ConfigValidation } from "../services/ConfigValidation.js";

export const ConfigValidationTest = {
	layer: (override?: ValidationResult): Layer.Layer<ConfigValidation> =>
		Layer.succeed(ConfigValidation, {
			validate: () => Effect.succeed(override ?? { errors: [], warnings: [], info: [] }),
		}),
} as const;

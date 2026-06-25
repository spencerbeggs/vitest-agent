const ALWAYS_CAPTURE = ["CI", "NODE_ENV", "VITEST_MODE"] as const;

/**
 * Capture CI and GitHub Actions environment variables for persistence.
 * @param env - The process environment record to read from
 * @returns A filtered map of relevant environment variable keys and values
 * @public
 */
export function captureEnvVars(env: Record<string, string | undefined>): Record<string, string> {
	const result: Record<string, string> = {};

	for (const key of ALWAYS_CAPTURE) {
		if (env[key] !== undefined) {
			result[key] = env[key];
		}
	}

	if (env.GITHUB_ACTIONS) {
		for (const [key, value] of Object.entries(env)) {
			if (value !== undefined && (key.startsWith("GITHUB_") || key.startsWith("RUNNER_"))) {
				result[key] = value;
			}
		}
	}

	return result;
}

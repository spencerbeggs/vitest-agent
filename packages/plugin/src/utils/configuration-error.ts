/**
 * A mistake in the user's own `AgentPlugin` configuration — a bad report
 * scope, an unsafe report filename — as opposed to an internal failure of
 * the plugin.
 *
 * `configureVitest` reports these as a single `vitest-agent: <message>`
 * line on stderr, with no stack trace and no "please report an issue"
 * banner: there is nothing to report, the user simply needs to fix the
 * config. Every other throw keeps the `formatFatalError` treatment.
 *
 * @public
 */
export class ConfigurationError extends Error {
	public override readonly name = "ConfigurationError";
}

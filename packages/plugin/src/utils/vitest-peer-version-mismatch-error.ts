/**
 * Builds the message `configureVitest` throws as a {@link ConfigurationError}
 * when the Vitest 5-only `ctx.defineCacheKeyGenerator` field is absent — the
 * reliable signal that the host project's `vitest` peer resolves to a pre-5
 * release (Vitest 4 exposes only the deprecated
 * `experimental_defineCacheKeyGenerator` alias).
 *
 * `@vitest-agent/plugin` 3.x is Vitest-5-only by design: no `experimental_`
 * fallback, no silent degradation. A version mismatch is the user's own
 * environment to fix, which is exactly what `ConfigurationError` means, so
 * this rides that class rather than introducing a parallel one — the catch
 * block in `configureVitest` keeps a single branch.
 *
 * The leading `vitest-agent: ` marker is part of the message because
 * `ConfigurationError` messages are written to stderr verbatim, not prefixed
 * at the write site.
 *
 * @internal
 */
export function vitestPeerVersionMismatchMessage(detectedVersion: string | undefined): string {
	const detected =
		detectedVersion !== undefined
			? `Detected Vitest ${detectedVersion}.`
			: "The installed Vitest version could not be detected.";
	return `vitest-agent: @vitest-agent/plugin 3.x requires Vitest >= 5. ${detected} Install @vitest-agent/plugin 2.x for Vitest 4.`;
}

/**
 * Reads a Vitest version string off the `ctx.vitest` instance handed to
 * `configureVitest`, if present and shaped as expected. Degrades to
 * `undefined` rather than throwing — this runs on the path that is already
 * diagnosing a version mismatch, so it must never itself fail on an
 * unexpected shape.
 *
 * @internal
 */
export function readVitestVersion(vitest: unknown): string | undefined {
	if (vitest === null || typeof vitest !== "object") return undefined;
	const version = (vitest as { version?: unknown }).version;
	return typeof version === "string" ? version : undefined;
}

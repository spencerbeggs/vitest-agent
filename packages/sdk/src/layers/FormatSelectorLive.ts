import { Effect, Layer } from "effect";
import type { OutputFormat } from "../schemas/Common.js";
import { FormatSelector } from "../services/FormatSelector.js";

/**
 * Default format dispatch:
 *
 * - GitHub Actions CI executor: `ci-annotations` (renders as `::error::`).
 * - Human executor: `silent` (Vitest's own reporters handle the user
 *   experience; we just write to the database).
 * - Anyone else (agent-shell, terminal-bound CI): `terminal` — plain
 *   text + ANSI color, no markdown syntax in the place that doesn't
 *   render it. Markdown stays available via explicit `format: "markdown"`
 *   for surfaces that *do* render it (MCP tools, GitHub step summary).
 * @public
 */
export const FormatSelectorLive = Layer.succeed(FormatSelector, {
	select: (executor, explicitFormat, environment) =>
		Effect.succeed<OutputFormat>(
			explicitFormat ??
				(environment === "ci-github" && executor === "ci"
					? "ci-annotations"
					: executor === "human"
						? "silent"
						: "terminal"),
		),
});

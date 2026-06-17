/**
 * Route a {@link RenderedOutput} entry to its declared target.
 *
 * Centralizes the side-effects that user-supplied reporters get to stay
 * pure about: writing to stdout, appending to a github-summary file, or
 * writing to an arbitrary file path. The plugin's internal Vitest reporter
 * calls this once per `RenderedOutput` returned by the user's reporter(s).
 *
 * `github-summary` writes go to `kit.config.githubSummaryFile` if set,
 * otherwise `process.env.GITHUB_STEP_SUMMARY`. When neither is set the
 * write is silently dropped — the typical case is "we're not under
 * GitHub Actions and the user-supplied reporter shouldn't have produced
 * one anyway."
 *
 * `file` outputs require an explicit path embedded in the output (a
 * convention reporters should adopt; this helper currently treats `file`
 * as a no-op until we settle on a path field). The default reporter
 * never produces `file` outputs today, so this gap is theoretical.
 *
 * @internal
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RenderedOutput } from "@vitest-agent/sdk";

export interface RouteOptions {
	/** Resolved github-summary file path (kit.config.githubSummaryFile). */
	readonly githubSummaryFile?: string;
}

export const routeRenderedOutput = (output: RenderedOutput, options: RouteOptions): void => {
	switch (output.target) {
		case "stdout": {
			process.stdout.write(`${output.content.replace(/\n+$/, "")}\n`);
			return;
		}
		case "github-summary": {
			const path = options.githubSummaryFile ?? process.env.GITHUB_STEP_SUMMARY;
			if (!path) return;
			try {
				mkdirSync(dirname(path), { recursive: true });
				appendFileSync(path, output.content, "utf8");
			} catch {
				// Best-effort: the file write is supplemental output, not the
				// primary signal. Swallow rather than crash the test run.
			}
			return;
		}
		case "file": {
			// Reporters wanting `file` outputs need to embed a target path.
			// No convention yet; treat as no-op for now. The default reporter
			// doesn't produce these, so the gap is hypothetical.
			return;
		}
	}
};

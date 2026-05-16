#!/usr/bin/env node
/**
 * `vitest-agent-sidecar-darwin-x64` SEA entry point.
 *
 * The thin program runner for this platform's Single Executable
 * Application (SEA) binary. It owns nothing but the process plumbing:
 * the argv-dispatch logic is a clean package export of
 * `vitest-agent-cli` ({@link dispatch}), imported here as a normal
 * package dependency — no cross-package filesystem paths.
 *
 * `dispatch` never throws; it folds every outcome into a
 * `{ stdout, stderr, code }` result. This runner flushes those
 * captured streams to the real stdout/stderr, then sets the exit
 * code and lets the event loop drain so a piped stdout is never
 * truncated.
 *
 * tsdown's `exe` build bundles `vitest-agent-cli` (and the Effect
 * runtime it pulls in) into the SEA — see this package's
 * `tsdown.config.ts`.
 *
 * @packageDocumentation
 */

import { dispatch } from "vitest-agent-cli";

const main = async (): Promise<void> => {
	const result = await dispatch(process.argv.slice(2));
	if (result.stdout.length > 0) process.stdout.write(result.stdout);
	if (result.stderr.length > 0) process.stderr.write(result.stderr);
	process.exitCode = result.code;
};

void main();

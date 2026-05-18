#!/usr/bin/env node
/**
 * `vitest-agent-sidecar-darwin-arm64` SEA entry point.
 *
 * The thin program runner for this platform's Single Executable
 * Application (SEA) binary. It owns nothing but the process plumbing:
 * the argv-dispatch logic is a clean package export of
 * `vitest-agent-sdk` ({@link dispatch}), imported from its dedicated
 * `vitest-agent-sdk/dispatch` entry point as a normal package
 * dependency. `vitest-agent-sdk` is a true leaf package, so this
 * import closes no workspace dependency cycle.
 *
 * `dispatch` never throws; it folds every outcome into a
 * `{ stdout, stderr, code }` result. This runner flushes those
 * captured streams to the real stdout/stderr, then sets the exit
 * code and lets the event loop drain so a piped stdout is never
 * truncated.
 *
 * The SEA build (`lib/scripts/tsdown.ts`) bundles the
 * `vitest-agent-sdk/dispatch` graph into the binary — a deliberately
 * narrow surface (`dispatch`, `injectEnv`, and the pure
 * `match-vitest-command` helpers), none of the Effect runtime or the
 * SQLite data layer.
 *
 * @packageDocumentation
 */

import { dispatch } from "vitest-agent-sdk/dispatch";

const main = async (): Promise<void> => {
	const result = await dispatch(process.argv.slice(2));
	if (result.stdout.length > 0) process.stdout.write(result.stdout);
	if (result.stderr.length > 0) process.stderr.write(result.stderr);
	process.exitCode = result.code;
};

void main();

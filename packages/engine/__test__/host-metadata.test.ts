import { describe, expect, it } from "vitest";
import { probeHostMetadataFromEnv } from "../src/utils/host-metadata.js";

/*
 * The 2.x env walk this module replaced (formerly sdk's
 * `utils/probe-host-metadata.ts`), kept verbatim as the oracle: every row it
 * produced must come out of the RuntimeEnv-backed probe byte for byte
 * (`JSON.stringify`, so metadata key order counts too), given the provider
 * marker the kit requires.
 */
const isUseful = (value: string | undefined): value is string => value !== undefined && value.length > 0;

const legacyProbe = (env: Record<string, string | undefined>) => {
	const decoration = (extra: Record<string, unknown>): Record<string, unknown> => {
		const baseDecoration: Record<string, unknown> = {};
		if (isUseful(env.TERM_PROGRAM)) baseDecoration.term_program = env.TERM_PROGRAM;
		if (isUseful(env.TERM_PROGRAM_VERSION)) baseDecoration.term_program_version = env.TERM_PROGRAM_VERSION;
		return { ...baseDecoration, ...extra };
	};

	if (isUseful(env.TMUX_PANE)) {
		return {
			source: "TMUX_PANE",
			value: env.TMUX_PANE,
			metadata: decoration(isUseful(env.TMUX) ? { tmux_socket: env.TMUX } : {}),
		};
	}

	if (isUseful(env.WT_SESSION)) {
		return { source: "WT_SESSION", value: env.WT_SESSION, metadata: decoration({}) };
	}

	if (isUseful(env.WEZTERM_PANE)) {
		return { source: "WEZTERM_PANE", value: env.WEZTERM_PANE, metadata: decoration({}) };
	}

	if (isUseful(env.KITTY_WINDOW_ID)) {
		return { source: "KITTY_WINDOW_ID", value: env.KITTY_WINDOW_ID, metadata: decoration({}) };
	}

	if (isUseful(env.TERM_SESSION_ID)) {
		return { source: "TERM_SESSION_ID", value: env.TERM_SESSION_ID, metadata: decoration({}) };
	}

	if (isUseful(env.GITHUB_RUN_ID)) {
		return {
			source: "GITHUB_RUN_ID",
			value: env.GITHUB_RUN_ID,
			metadata: decoration({
				ci: true,
				ci_provider: "github",
				...(isUseful(env.GITHUB_RUN_ATTEMPT) ? { github_run_attempt: env.GITHUB_RUN_ATTEMPT } : {}),
			}),
		};
	}

	if (isUseful(env.BUILDKITE_JOB_ID)) {
		return {
			source: "BUILDKITE_JOB_ID",
			value: env.BUILDKITE_JOB_ID,
			metadata: decoration({ ci: true, ci_provider: "buildkite" }),
		};
	}

	if (isUseful(env.CIRCLE_BUILD_NUM)) {
		return {
			source: "CIRCLE_BUILD_NUM",
			value: env.CIRCLE_BUILD_NUM,
			metadata: decoration({ ci: true, ci_provider: "circle" }),
		};
	}

	if (isUseful(env.GITLAB_CI_JOB_ID)) {
		return {
			source: "GITLAB_CI_JOB_ID",
			value: env.GITLAB_CI_JOB_ID,
			metadata: decoration({ ci: true, ci_provider: "gitlab" }),
		};
	}

	return { source: null, value: null, metadata: null };
};

const byteIdentical = (env: Record<string, string | undefined>): void => {
	expect(JSON.stringify(probeHostMetadataFromEnv(env))).toBe(JSON.stringify(legacyProbe(env)));
};

describe("probeHostMetadataFromEnv", () => {
	it.each([
		["no source", {}],
		["TMUX_PANE with TMUX socket", { TMUX_PANE: "%3", TMUX: "/tmp/tmux-501/default,123,0", WT_SESSION: "skipped" }],
		["TMUX_PANE without TMUX", { TMUX_PANE: "%3" }],
		["WT_SESSION under tmux (no tmux_socket)", { WT_SESSION: "wt", TMUX: "/sock" }],
		["WEZTERM_PANE", { WEZTERM_PANE: "5" }],
		["KITTY_WINDOW_ID", { KITTY_WINDOW_ID: "1" }],
		[
			"TERM_SESSION_ID with TERM_PROGRAM pair",
			{ TERM_SESSION_ID: "w0t0p0:UUID", TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.6.10" },
		],
		["TERM_PROGRAM_VERSION alone", { KITTY_WINDOW_ID: "1", TERM_PROGRAM_VERSION: "0.30" }],
		["empty values read as unset", { TMUX_PANE: "", WT_SESSION: "real-value" }],
		["whitespace values are kept", { WT_SESSION: " " }],
		["session beats CI", { TMUX_PANE: "%5", GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "999" }],
		[
			"GitHub run + attempt",
			{ GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "2", TERM_PROGRAM: "vscode" },
		],
		["GitHub run without attempt", { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "12345" }],
		["Buildkite job", { BUILDKITE: "true", BUILDKITE_JOB_ID: "buildkite-uuid" }],
		["CircleCI build", { CIRCLECI: "true", CIRCLE_BUILD_NUM: "77", CIRCLE_WORKFLOW_ID: "wf" }],
	] as const)("matches the 2.x row: %s", (_name, env) => {
		byteIdentical(env);
	});

	it("never records GNU screen: STY falls through to the next source as 2.x did", () => {
		byteIdentical({ STY: "123.pts-0.host", WT_SESSION: "wt" });
		byteIdentical({ STY: "123.pts-0.host", GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "1" });
		expect(probeHostMetadataFromEnv({ STY: "123.pts-0.host" })).toStrictEqual({
			source: null,
			value: null,
			metadata: null,
		});
	});

	it("records a GitLab job from CI_JOB_ID (the 2.x probe read a variable GitLab never sets)", () => {
		expect(probeHostMetadataFromEnv({ GITLAB_CI: "true", CI_JOB_ID: "55" })).toStrictEqual({
			source: "CI_JOB_ID",
			value: "55",
			metadata: { ci: true, ci_provider: "gitlab" },
		});
	});

	it("needs the provider's own marker: a bare GITHUB_RUN_ID or BUILDKITE_JOB_ID is no longer a source", () => {
		expect(probeHostMetadataFromEnv({ GITHUB_RUN_ID: "1" }).source).toBeNull();
		expect(probeHostMetadataFromEnv({ BUILDKITE_JOB_ID: "1" }).source).toBeNull();
		expect(probeHostMetadataFromEnv({ GITHUB_ACTIONS: "false", GITHUB_RUN_ID: "1" }).source).toBeNull();
	});

	it("records nothing for a CI without a persisted job coordinate", () => {
		expect(probeHostMetadataFromEnv({ CI: "true" }).source).toBeNull();
		expect(probeHostMetadataFromEnv({ TRAVIS: "true", TRAVIS_JOB_ID: "1" }).source).toBeNull();
	});
});

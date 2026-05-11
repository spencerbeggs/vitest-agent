import { describe, expect, it } from "vitest";
import { probeHostMetadataFromEnv } from "../src/utils/probe-host-metadata.js";

const empty: Record<string, string | undefined> = {};

describe("probeHostMetadataFromEnv", () => {
	it("returns null host when no probe matches", () => {
		const result = probeHostMetadataFromEnv(empty);
		expect(result.source).toBeNull();
		expect(result.value).toBeNull();
	});

	it("matches TMUX_PANE first when present", () => {
		const result = probeHostMetadataFromEnv({
			TMUX_PANE: "%3",
			WT_SESSION: "should-be-skipped",
			TERM_SESSION_ID: "skipped",
		});
		expect(result.source).toBe("TMUX_PANE");
		expect(result.value).toBe("%3");
	});

	it("matches WT_SESSION when TMUX_PANE absent", () => {
		const result = probeHostMetadataFromEnv({
			WT_SESSION: "abc-123",
			TERM_SESSION_ID: "skipped",
		});
		expect(result.source).toBe("WT_SESSION");
		expect(result.value).toBe("abc-123");
	});

	it("matches WEZTERM_PANE when higher-priority probes absent", () => {
		const result = probeHostMetadataFromEnv({ WEZTERM_PANE: "5" });
		expect(result.source).toBe("WEZTERM_PANE");
		expect(result.value).toBe("5");
	});

	it("matches KITTY_WINDOW_ID", () => {
		const result = probeHostMetadataFromEnv({ KITTY_WINDOW_ID: "1" });
		expect(result.source).toBe("KITTY_WINDOW_ID");
		expect(result.value).toBe("1");
	});

	it("matches TERM_SESSION_ID for iTerm/Terminal.app", () => {
		const result = probeHostMetadataFromEnv({
			TERM_SESSION_ID: "w0t0p0:UUID",
			TERM_PROGRAM: "iTerm.app",
		});
		expect(result.source).toBe("TERM_SESSION_ID");
		expect(result.value).toBe("w0t0p0:UUID");
	});

	it("matches GITHUB_RUN_ID with GITHUB_RUN_ATTEMPT decoration", () => {
		const result = probeHostMetadataFromEnv({
			GITHUB_RUN_ID: "12345",
			GITHUB_RUN_ATTEMPT: "2",
		});
		expect(result.source).toBe("GITHUB_RUN_ID");
		expect(result.value).toBe("12345");
		expect(result.metadata).toMatchObject({
			ci: true,
			ci_provider: "github",
			github_run_attempt: "2",
		});
	});

	it("captures TERM_PROGRAM into metadata when present", () => {
		const result = probeHostMetadataFromEnv({
			TERM_SESSION_ID: "iterm-uuid",
			TERM_PROGRAM: "iTerm.app",
			TERM_PROGRAM_VERSION: "3.6.10",
		});
		expect(result.metadata).toMatchObject({
			term_program: "iTerm.app",
			term_program_version: "3.6.10",
		});
	});

	it("matches BUILDKITE_JOB_ID for non-GitHub CI", () => {
		const result = probeHostMetadataFromEnv({ BUILDKITE_JOB_ID: "buildkite-uuid" });
		expect(result.source).toBe("BUILDKITE_JOB_ID");
		expect(result.value).toBe("buildkite-uuid");
		expect(result.metadata?.ci).toBe(true);
	});

	it("respects strict probe priority — TMUX wins over GITHUB", () => {
		const result = probeHostMetadataFromEnv({
			TMUX_PANE: "%5",
			GITHUB_RUN_ID: "999",
		});
		expect(result.source).toBe("TMUX_PANE");
	});

	it("ignores empty-string env values (treats as not set)", () => {
		const result = probeHostMetadataFromEnv({
			TMUX_PANE: "",
			WT_SESSION: "real-value",
		});
		expect(result.source).toBe("WT_SESSION");
		expect(result.value).toBe("real-value");
	});
});

import { describe, expect, it, vi } from "vitest";
import { AgentPlugin } from "../src/plugin.js";

/**
 * Minimal shape of the Vite `Logger` interface that `AgentPlugin`'s
 * `configResolved` hook reads/writes. Only `warn` is exercised by the
 * source-map filter; `info`/`error`/`warnOnce`/`hasWarned` exist so the
 * fake satisfies the real Vite `Logger` contract shape.
 */
function makeFakeResolvedConfig() {
	const warn = vi.fn();
	const logger = {
		hasWarned: false,
		info: vi.fn(),
		warn,
		warnOnce: vi.fn(),
		error: vi.fn(),
	};
	return { config: { logger }, logger, originalWarn: warn };
}

describe("AgentPlugin vite logger source-map warning filter", () => {
	// ── Goal 3, Behavior 7: configResolved wraps logger.warn ─────────────────
	it("should wrap resolvedConfig.logger.warn with a new function in configResolved", () => {
		// Given: a plugin instance and a fake resolved Vite config
		const plugin = AgentPlugin();
		const { config, logger, originalWarn } = makeFakeResolvedConfig();

		// When: the configResolved hook runs against the fake config
		expect(typeof plugin.configResolved).toBe("function");
		plugin.configResolved?.(config as never);

		// Then: logger.warn has been replaced with a new function reference
		expect(logger.warn).not.toBe(originalWarn);
	});

	// ── Goal 3, Behavior 8: suppresses benign source-map warning ─────────────
	it("should suppress a benign source-map warning without calling the original warn", () => {
		// Given: a plugin instance with configResolved installed against a fake config
		const plugin = AgentPlugin();
		const { config, logger, originalWarn } = makeFakeResolvedConfig();
		plugin.configResolved?.(config as never);
		const benignMessage =
			"Failed to load source map for /repo/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js.\n" +
			"Error: ENOENT: no such file or directory, open '/repo/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js.map'";

		// When: the wrapped warn is called with the benign message
		logger.warn(benignMessage);

		// Then: the original warn is never invoked — the message is dropped
		expect(originalWarn).not.toHaveBeenCalled();
	});

	// ── Goal 3, Behavior 9: forwards non-matching warning unchanged ──────────
	it("should forward a non-matching warning to the original warn unchanged", () => {
		// Given: a plugin instance with configResolved installed against a fake config
		const plugin = AgentPlugin();
		const { config, logger, originalWarn } = makeFakeResolvedConfig();
		plugin.configResolved?.(config as never);
		const unrelatedMessage = "[vite] some other warning";

		// When: the wrapped warn is called with an unrelated message
		logger.warn(unrelatedMessage, { timestamp: true });

		// Then: the original warn is called with the exact same arguments
		expect(originalWarn).toHaveBeenCalledWith(unrelatedMessage, { timestamp: true });
	});
});

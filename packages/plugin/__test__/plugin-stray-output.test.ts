/**
 * `configureVitest` installs the stray-output capture on `vitest.logger`
 * once per Vitest instance, and only when the plugin owns the console:
 * in `passthrough` Vitest's own reporters write through the same streams.
 */

import { Writable } from "node:stream";
import { EnvironmentDetectorTest } from "@vitest-agent/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VitestPluginContext } from "vitest/node";
import { AgentPlugin } from "../src/plugin.js";
import { strayOutputCaptureOf } from "../src/utils/stray-output-capture.js";

const sink = () =>
	new Writable({
		write(_chunk, _enc, cb) {
			cb();
		},
	});

const mockVitest = () => {
	const outputStream = sink();
	const errorStream = sink();
	return {
		config: { reporters: ["default"] as unknown[], coverage: {} },
		vite: { config: { cacheDir: "node_modules/.vite" } },
		onClose: vi.fn(),
		logger: { outputStream: outputStream as Writable, errorStream: errorStream as Writable },
		originals: { outputStream, errorStream },
	};
};

const configure = async (plugin: ReturnType<typeof AgentPlugin>, vitest: ReturnType<typeof mockVitest>, name: string) =>
	plugin.configureVitest({
		vitest,
		project: { name },
		defineCacheKeyGenerator: vi.fn(),
	} as unknown as VitestPluginContext);

describe("AgentPlugin stray-output capture", () => {
	let stderrWrite: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});
	afterEach(() => {
		stderrWrite.mockRestore();
	});

	it("wraps the Logger's streams once across every project's configureVitest", async () => {
		const plugin = AgentPlugin({ console: { agent: "agent" } }, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest();
		await configure(plugin, vitest, "a");
		const wrapped = { out: vitest.logger.outputStream, err: vitest.logger.errorStream };
		await configure(plugin, vitest, "b");
		await configure(plugin, vitest, "c");
		expect(strayOutputCaptureOf(vitest.logger)).toBeDefined();
		expect(wrapped.out).not.toBe(vitest.originals.outputStream);
		expect(wrapped.err).not.toBe(vitest.originals.errorStream);
		expect(vitest.logger.outputStream).toBe(wrapped.out);
		expect(vitest.logger.errorStream).toBe(wrapped.err);
	});

	it("leaves the streams alone in passthrough", async () => {
		const plugin = AgentPlugin({ console: { human: "passthrough" } }, EnvironmentDetectorTest.layer("terminal"));
		const vitest = mockVitest();
		await configure(plugin, vitest, "a");
		expect(strayOutputCaptureOf(vitest.logger)).toBeUndefined();
		expect(vitest.logger.outputStream).toBe(vitest.originals.outputStream);
	});
});

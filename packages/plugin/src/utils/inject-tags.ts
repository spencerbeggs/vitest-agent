import type { SourceMap } from "magic-string";
import MagicString from "magic-string";

function tagsLiteral(tags: ReadonlyArray<string>): string {
	return `[${tags.map((t) => JSON.stringify(t)).join(", ")}]`;
}

/**
 * Builds the guarded prelude that applies the classified tags to the file
 * task at collection time. `TestRunner.getCurrentSuite()` is a public
 * static on the main vitest entry (>= 4.1, the plugin's peer floor); the
 * `.suite ?? .file` fallback mirrors vitest's own parent-task resolution.
 * The runner unions parent tags into every suite and test it registers,
 * so tags set here are inherited by every declaration form in the file —
 * native it/test, wrapper testers like @effect/vitest's it.effect, aliases
 * from test.extend, and dynamically registered tests (issue #133). The
 * namespace import plus optional chaining on `TestRunner` means environments
 * whose "vitest" entry lacks the `TestRunner` export (e.g. vitest's browser-
 * mode entry) degrade to untagged tests instead of a module-instantiation
 * failure. If a future vitest changes the collector shape, the try/catch
 * degrades to "tests carry no tags" — never a crash.
 */
function preludeFor(tags: ReadonlyArray<string>): string {
	return (
		'import * as __vitestAgentVitest from "vitest";\n' +
		"try { " +
		"const __vitestAgentCollector = __vitestAgentVitest.TestRunner?.getCurrentSuite?.(); " +
		"const __vitestAgentTask = __vitestAgentCollector?.suite ?? __vitestAgentCollector?.file; " +
		"if (__vitestAgentTask) { " +
		`__vitestAgentTask.tags = [...new Set([...(__vitestAgentTask.tags ?? []), ...${tagsLiteral(tags)}])]; ` +
		"} } catch {}\n"
	);
}

/**
 * Return value of the Vite `transform` hook — the rewritten source code and its source map.
 * @public
 */
export interface InjectTagsResult {
	/** The transformed source code string with the prepended tag prelude. */
	code: string;
	/** Source map correlating transformed positions back to the original source. */
	map: SourceMap;
}

export function injectTags(source: string, tags: ReadonlyArray<string>): InjectTagsResult | null {
	if (tags.length === 0) return null;
	const ms = new MagicString(source);
	ms.prepend(preludeFor(tags));
	return { code: ms.toString(), map: ms.generateMap() };
}

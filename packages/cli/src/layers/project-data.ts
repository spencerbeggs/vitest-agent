// The CLI's project-database layering.
//
// `ProjectDir` is the one place the resolved project directory (and the env it
// was resolved from) lives: `main.ts` provides it in the root platform, and
// every command that needs the directory reads it from here instead of
// re-deriving it from `process`. `ProjectDataLive` opens the project
// `data.db` (SQLite + migrations) and is attached with `Command.provide` to
// only the commands that use the engine's data services, so a hook command
// that never touches the database never opens it.

import { PlatformLive, resolveDataPath } from "@vitest-agent/engine";
import { Context, Effect, Layer } from "effect";

/**
 * The resolved absolute project directory plus the environment it was
 * resolved from. Provided once by `main.ts` from `resolveProjectDir`.
 */
export class ProjectDir extends Context.Service<
	ProjectDir,
	{
		readonly dir: string;
		readonly env: NodeJS.ProcessEnv;
	}
>()("vitest-agent/cli/ProjectDir") {}

/**
 * The engine's `PlatformLive` over the project `data.db`, built only when a
 * command that needs it runs. `logger: false`: the root `CliLog` layer is the
 * one logger set, and the engine's `LoggerLive` would replace it.
 */
export const ProjectDataLive = Layer.unwrap(
	Effect.gen(function* () {
		const { dir, env } = yield* ProjectDir;
		const dbPath = yield* resolveDataPath(dir);
		return PlatformLive({ dbPath, env, logger: false });
	}),
);

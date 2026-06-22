import { Schema } from "effect";

/**
 * Schema for the optional `vitest-agent.config.toml` file.
 *
 * Both fields are optional. When the file is absent or these fields are
 * unset, `resolveDataPath` falls back to deriving the path from the
 * workspace's `package.json` `name` under the XDG data directory.
 *
 * Fields:
 * - `cacheDir` — absolute path overriding the entire data directory. Highest
 *   precedence after the programmatic option. Use this to relocate the SQLite
 *   database (e.g. project-local `.vitest-agent/`) instead of the
 *   default XDG location.
 * - `projectKey` — overrides the workspace key segment under the XDG data
 *   directory. Use this when two unrelated projects on the same machine
 *   share a `package.json` `name` (the collision case for workspace-name
 *   keying), or when you want a stable key independent of `name` changes.
 * @public
 */
export class VitestAgentConfig extends Schema.Class<VitestAgentConfig>("VitestAgentConfig")({
	cacheDir: Schema.optional(Schema.String),
	projectKey: Schema.optional(Schema.String),
}) {}

/*
 * The two `package.json` fields vitest-agent reads — `name` and the
 * `repository` URL — over `@effected/package-json`'s shape-lenient
 * `LenientManifest` (strict `JSON.parse` syntax, a malformed field degrades to
 * absence) and its `Repository` model (string and object forms alike). Every
 * engine reader of these fields goes through here, so the project key and the
 * identity source agree on what a manifest says.
 */

import { Repository } from "@effected/package-json";
import { Option, Schema } from "effect";

const decodeRepository = Schema.decodeUnknownOption(Repository.FromValue);

/**
 * The trimmed `repository` URL a manifest names, from the string form or the
 * object form's `url`, or `null` when there is none (absent, blank, an object
 * with no string `url`, or a value of neither form).
 *
 * @internal
 */
export const repositoryUrlOf = (repository: unknown): string | null =>
	repository === undefined
		? null
		: Option.match(decodeRepository(repository), {
				onNone: () => null,
				onSome: (repo) => {
					const url = repo.url.trim();
					return url.length > 0 ? url : null;
				},
			});

/**
 * Cache-key material for Vitest 5's `fsModuleCache`.
 *
 * The tag-injection transform's output depends on the classification tag
 * set, which Vitest cannot see. Returning this string from a
 * `defineCacheKeyGenerator` callback folds the tag set into the module
 * cache key, so a changed tag set invalidates the cached prelude.
 *
 * @internal
 */
export function tagCacheKey(tags: ReadonlyArray<string>): string {
	return `vitest-agent:tags:${[...tags].sort().join(",")}`;
}

/**
 * Builds the `defineCacheKeyGenerator` callback from the same per-id
 * classification the `transform` hook uses. Ids the transform would not
 * rewrite contribute nothing to the cache key.
 *
 * @internal
 */
export function makeTagCacheKeyGenerator(
	classify: (id: string) => ReadonlyArray<string> | undefined,
): (context: { id: string }) => string | undefined {
	return (context) => {
		const tags = classify(context.id);
		return tags === undefined ? undefined : tagCacheKey(tags);
	};
}

/**
 * Format a per-row tag-count suffix — sorted `tag:count` pairs joined
 * by two spaces. A single tag is suppressed: a project that is all one
 * kind carries no signal worth the column, matching the agent
 * renderer's behaviour.
 *
 * @packageDocumentation
 */

export const formatTagSuffix = (tagCounts: Record<string, number> | undefined): string => {
	if (tagCounts === undefined) return "";
	const entries = Object.entries(tagCounts);
	if (entries.length <= 1) return "";
	return [...entries]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([tag, count]) => `${tag}:${count}`)
		.join("  ");
};

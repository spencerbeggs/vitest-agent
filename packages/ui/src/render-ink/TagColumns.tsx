/**
 * Fixed-width tag-count columns for aggregate rows in the `stream` view.
 * Every row renders every tag in the view's union so the columns align
 * across rows; a zero count is dimmed gray, a nonzero count cyan. Each
 * cell is the tag label, a colon, and a 4-digit right-aligned count;
 * cells sit two spaces apart.
 */

import { Text } from "ink";
import type { FC } from "react";

/**
 * Compute the view-level tag union: the alphabetically sorted set of tag
 * names across every row's tag counts. A union of a single tag carries no
 * signal (the whole view is one kind), so it collapses to empty and the
 * view renders no tag columns at all.
 *
 * @public
 */
export const tagUnion = (rows: ReadonlyArray<Record<string, number> | undefined>): ReadonlyArray<string> => {
	const names = new Set<string>();
	for (const row of rows) {
		for (const tag of Object.keys(row ?? {})) names.add(tag);
	}
	if (names.size <= 1) return [];
	return [...names].sort((a, b) => a.localeCompare(b));
};

/**
 * Props for the `TagColumns` component.
 *
 * @public
 */
export interface TagColumnsProps {
	/** The view-level tag union — every row renders every tag in it. */
	readonly tags: ReadonlyArray<string>;
	/** This row's per-tag test counts; tags absent here render a dimmed 0. */
	readonly counts?: Record<string, number> | undefined;
}

/**
 * Renders one row's fixed-width tag cells for the given tag union.
 * Renders nothing when the union is empty.
 *
 * @public
 */
export const TagColumns: FC<TagColumnsProps> = ({ tags, counts }) => {
	if (tags.length === 0) return null;
	return (
		<Text>
			{tags.map((tag, i) => {
				const count = counts?.[tag] ?? 0;
				return (
					<Text key={tag} color={count > 0 ? "cyan" : "gray"}>
						{i > 0 ? "  " : ""}
						{tag}:{String(count).padStart(4)}
					</Text>
				);
			})}
		</Text>
	);
};

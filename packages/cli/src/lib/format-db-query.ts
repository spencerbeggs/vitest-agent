/**
 * Pure formatter for `db query` output.
 *
 * Renders the row array returned by a read-only SQL query as either
 * whitespace-padded tabular text or a JSON array of row objects.
 *
 * @packageDocumentation
 */

export type DbQueryFormat = "table" | "json";

export type DbQueryRow = Record<string, unknown>;

const renderCell = (value: unknown): string => {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
};

/**
 * Render query rows as whitespace-padded tabular text or a JSON array.
 *
 * Table format: column headers in the first line, one row per line,
 * each cell padded to its column's widest value. An empty result set
 * renders as `(0 rows)`. JSON format emits a single array of row
 * objects keyed by column name; an empty result set is `[]`.
 */
export const formatDbQuery = (rows: ReadonlyArray<DbQueryRow>, format: DbQueryFormat): string => {
	if (format === "json") {
		return JSON.stringify(rows);
	}
	if (rows.length === 0) {
		return "(0 rows)";
	}
	const columns = Object.keys(rows[0]);
	const cells = rows.map((row) => columns.map((col) => renderCell(row[col])));
	const widths = columns.map((col, i) => Math.max(col.length, ...cells.map((row) => row[i].length)));
	const renderLine = (values: ReadonlyArray<string>): string =>
		values
			.map((value, i) => value.padEnd(widths[i]))
			.join("  ")
			.trimEnd();
	return [renderLine(columns), ...cells.map(renderLine)].join("\n");
};

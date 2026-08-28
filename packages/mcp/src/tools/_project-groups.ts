import { Effect } from "effect";

export interface ProjectTarget {
	readonly project: string;
}

export interface ProjectRows<Row> {
	readonly project: string;
	readonly rows: ReadonlyArray<Row>;
}

export const resolveProjectTargets = <E>(
	project: string | undefined,
	listProjects: () => Effect.Effect<ReadonlyArray<{ readonly project: string }>, E>,
): Effect.Effect<ReadonlyArray<ProjectTarget>, E> =>
	project
		? Effect.succeed([{ project }])
		: Effect.map(listProjects(), (runs) => runs.map((run) => ({ project: run.project })));

export const collectProjectRows = <Row, E, R>(
	targets: ReadonlyArray<ProjectTarget>,
	listRows: (project: string) => Effect.Effect<ReadonlyArray<Row>, E, R>,
): Effect.Effect<{ readonly groups: Array<ProjectRows<Row>>; readonly total: number }, E, R> =>
	Effect.gen(function* () {
		const groups: Array<ProjectRows<Row>> = [];
		let total = 0;
		for (const target of targets) {
			const rows = yield* listRows(target.project);
			if (rows.length === 0) {
				continue;
			}
			groups.push({ project: target.project, rows });
			total += rows.length;
		}
		return { groups, total };
	});

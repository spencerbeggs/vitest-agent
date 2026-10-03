# DataModel

* [Dispatcher Matrix](dispatcher-matrix.md) - The 4 run-shapes x 3 outcome-classes cell table that selects console output: the classify step, the two per-cell halves, the footer, and what a new shape or outcome must add.
* [RunEvent and RenderState](run-events.md) - The RunEvent discriminated union, the ordering guarantees the reducer relies on, and the RenderState it projects — the shape both the Ink and agent renderers read instead of the raw event stream.
* [SQLite Schema](sqlite-schema.md) - The three SQLite databases (per-project data.db, per-client sessions.db, global registry.db), their tables, attribution columns, cascade rules, and migration ledgers, and what breaks when a migration is edited in place.

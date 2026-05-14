/**
 * Transport binding for the persistence layer.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * Transport binding for the persistence layer.
 *
 * 2.x ships only `{ kind: "local" }`. Modeled as a single-member
 * discriminated union so the 3.0 cloud-backend swap (D1, Turso, etc.)
 * lands as a pure addition of new union members — no schema-shape
 * diff and no breaking API change at the call site.
 */
export const Transport = Schema.Union(Schema.Struct({ kind: Schema.Literal("local") })).annotations({
	identifier: "Transport",
});
export type Transport = typeof Transport.Type;

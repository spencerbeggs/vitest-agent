# Testing Effect Schema Definitions

## When to use

When you have an Effect Schema (`Schema.Struct`, `Schema.Class`, branded type, transformation) that defines a public-API shape and you want to verify: round-trip encode/decode preserves data, decoding rejects invalid input with useful errors, transformations behave correctly.

## Three test patterns

### Pattern A: round-trip

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const User = Schema.Struct({
 id: Schema.Number,
 name: Schema.String,
});

it("round-trips through encode + decode", () => {
 const value = { id: 42, name: "Ada" };
 const encoded = Schema.encodeUnknownSync(User)(value);
 const decoded = Schema.decodeUnknownSync(User)(encoded);
 expect(decoded).toEqual(value);
});
```

### Pattern B: decoding error assertions

```typescript
import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

it("rejects invalid input with the expected error path", () => {
 const result = Schema.decodeUnknownEither(User)({ id: "not-a-number", name: "Ada" });
 expect(Either.isLeft(result)).toBe(true);
 if (Either.isLeft(result)) {
  const formatted = String(result.left);
  expect(formatted).toContain("id");
  expect(formatted).toMatch(/expected number/i);
 }
});
```

### Pattern C: transformations

For `Schema.transform` between two shapes (typical for parsing JSON-stringified payloads):

```typescript
const Comma = Schema.transform(Schema.String, Schema.Array(Schema.String), {
 decode: (s) => s.split(","),
 encode: (a) => a.join(","),
});

it("decodes and encodes the inverse", () => {
 expect(Schema.decodeUnknownSync(Comma)("a,b,c")).toEqual(["a", "b", "c"]);
 expect(Schema.encodeUnknownSync(Comma)(["a", "b"])).toBe("a,b");
});
```

## Anti-patterns

- **Don't assert on stringified errors verbatim.** Effect Schema's error formatting can shift between minor versions; assert on substrings or use `ParseResult.TreeFormatter` for stable output.
- **Don't write tests that rely on `Schema.transformOrFail` failing _silently_.** When a transform can fail, exercise the failure path explicitly — `Either` results from `decodeUnknownEither` are the right tool.
- **Don't recreate the schema in the test.** Import the production definition; otherwise the test passes when the production schema drifts.

## See also

- `vitest://docs/api/expect` — Vitest matcher reference for the assertion patterns
- `vitest-agent://patterns/testing-effect-services-with-mock-layers` — Companion pattern; services hand around Schema-typed data
- Effect Schema docs at `https://effect.website/docs/schema/introduction`

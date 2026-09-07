---
"@vitest-agent/reporter": major
---

## Breaking Changes

### Requires Vitest 5

The `vitest` peer range moves to `^5.0.0`, and the optional
`@vitest/coverage-v8` / `@vitest/coverage-istanbul` peers move with it.
Vitest 4 is no longer supported. Vitest 5 declares `vite` as a required
peer dependency of `vitest` rather than a regular one, so install it
explicitly alongside the upgrade.

```bash
npm install -D vitest@^5 vite@^8
```

No reporter hook signature changed: `onInit`, `onTestRunStart`,
`onTestRunEnd`, and every streaming hook the default reporter taps are
identical in Vitest 5.

## Dependencies

| Dependency | Type | Action | From | To |
| :--------- | :--- | :----- | :--- | :-- |
| vitest | peerDependency | updated | ^4.1.0 | ^5.0.0 |
| @vitest/coverage-v8 | peerDependency | updated | ^4.1.0 | ^5.0.0 |
| @vitest/coverage-istanbul | peerDependency | updated | ^4.1.0 | ^5.0.0 |

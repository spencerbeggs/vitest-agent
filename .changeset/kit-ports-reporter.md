---
"@vitest-agent/reporter": patch
---

## Bug Fixes

* Stray output lines are printed through the live handle, so they no longer strand live-view headers.
* The stream view is driven through the detached live handle.

## Dependencies

Removed peer dependencies the package never imported.

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| @effected/walker | peerDependency | removed | catalog:effected | — |
| @vitest/coverage-istanbul | peerDependency | removed | catalog:test:peers | — |
| @vitest/coverage-v8 | peerDependency | removed | catalog:test:peers | — |
| vitest | peerDependency | removed | catalog:test:peers | — |

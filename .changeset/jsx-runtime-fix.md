---
"vitest-agent-ui": patch
---

## Bug Fixes

### React automatic JSX runtime in built output

The `vitest-agent-ui` distribution now emits `jsx`/`jsxs` imports from `react/jsx-runtime` instead of bare `React.createElement(...)` calls. The prior output assumed a `React` namespace binding that the automatic-runtime sources do not import, causing runtime errors for consumers who had not set up a global `React` import.

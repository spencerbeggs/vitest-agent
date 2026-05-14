// packages/mcp/lib/scripts/annotations-heuristic.ts
//
// First-cut MCP resource annotations from the manifest path. Each
// content type maps to a priority band per the editorial guide in
// docs/superpowers/specs/2.0-resource-annotations.md §2. The skill's
// review pass tightens each value but the heuristic gives every page a
// reasonable starting point.
//
// Used by build-snapshot.ts (seeds annotations on a fresh snapshot) and
// apply-annotations.ts (one-shot pass over an existing manifest).

import type { ResourceAnnotations } from "../../src/resources/manifest-schema.js";

interface Rule {
	readonly prefix: string;
	readonly priority: number;
}

// Order matters — more specific prefixes must match before their parents.
const RULES: ReadonlyArray<Rule> = [
	// Browser-mode experimental — both API and config and guide
	{ prefix: "api/browser/", priority: 0.55 },
	{ prefix: "config/browser/", priority: 0.55 },
	{ prefix: "guide/browser/", priority: 0.55 },

	// Coverage — surfaces both the config option and the guide explainer
	{ prefix: "config/coverage", priority: 0.85 },
	{ prefix: "guide/coverage", priority: 0.85 },

	// Migration — much lower priority than active docs
	{ prefix: "guide/migration", priority: 0.45 },

	// API reference — advanced internals slightly lower than core API
	{ prefix: "api/advanced/", priority: 0.8 },
	{ prefix: "api/", priority: 0.9 },

	// Config reference — most pages
	{ prefix: "config/", priority: 0.85 },

	// Guide — learning / writing tests carries the core guide weight
	{ prefix: "guide/learn/", priority: 0.8 },
	{ prefix: "guide/mocking", priority: 0.8 },
	{ prefix: "guide/advanced/", priority: 0.7 },

	// Generic guide fallback
	{ prefix: "guide/", priority: 0.78 },
];

const FALLBACK_PRIORITY = 0.5;

/**
 * Heuristic mapping from a manifest page path (no trailing .md) to a
 * default ResourceAnnotations payload. Always sets `audience` to
 * `["assistant"]`; the priority comes from the first matching rule, or
 * a conservative 0.5 fallback when no rule fires (the caller is
 * expected to manually review unmatched pages).
 */
export function seedAnnotations(path: string): ResourceAnnotations {
	for (const rule of RULES) {
		if (path === rule.prefix || path.startsWith(rule.prefix)) {
			return { audience: ["assistant"], priority: rule.priority };
		}
	}
	return { audience: ["assistant"], priority: FALLBACK_PRIORITY };
}

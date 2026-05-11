/**
 * Canonicalize a git remote URL into a stable, presentation-free form
 * that hashes identically across SSH/HTTPS variants, casing variations,
 * and trailing-`.git` differences.
 *
 * The canonical form is `host/path` (e.g.
 * `github.com/spencerbeggs/vitest-agent`). It is the source of truth for
 * the per-project `project_key` — two checkouts of the same repo on
 * different machines, regardless of clone protocol, hash to the same
 * value.
 *
 * @packageDocumentation
 */

const SCHEME_PREFIXES = ["git+ssh://", "git+https://", "ssh://", "https://", "http://"] as const;

const SSH_SHORTHAND_REGEX = /^(?:[\w.-]+@)?([\w.-]+):(.+)$/;

/**
 * Canonicalize a git remote URL.
 *
 * Returns `null` when the input is empty, whitespace-only, or has
 * neither a host nor a path after stripping known prefixes.
 *
 * Steps applied in order:
 *
 * 1. Trim whitespace.
 * 2. If the value starts with `[git+]ssh|https|http://`, strip the
 *    scheme. After stripping, drop any embedded `user@` segment.
 * 3. Otherwise, try the SSH shorthand `user@host:path` pattern; on a
 *    match, rebuild as `host/path` (drop the user).
 * 4. Strip trailing `.git`.
 * 5. Strip trailing `/`.
 * 6. Lowercase the entire string.
 * 7. Reject if the result is empty or has no `/` (no path) — a bare
 *    host like `github.com` is not a project identity.
 */
export const canonicalizeGitUrl = (raw: string): string | null => {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;

	let value = trimmed;

	const matchedPrefix = SCHEME_PREFIXES.find((prefix) => value.startsWith(prefix));
	if (matchedPrefix !== undefined) {
		value = value.slice(matchedPrefix.length);
		const atIndex = value.indexOf("@");
		const slashIndex = value.indexOf("/");
		if (atIndex !== -1 && (slashIndex === -1 || atIndex < slashIndex)) {
			value = value.slice(atIndex + 1);
		}
	} else {
		const sshMatch = value.match(SSH_SHORTHAND_REGEX);
		if (sshMatch !== null) {
			value = `${sshMatch[1]}/${sshMatch[2]}`;
		}
	}

	if (value.endsWith(".git")) value = value.slice(0, -".git".length);
	if (value.endsWith("/")) value = value.slice(0, -1);
	value = value.toLowerCase();

	if (value.length === 0 || !value.includes("/")) return null;
	const slashIndex = value.indexOf("/");
	if (slashIndex === 0 || slashIndex === value.length - 1) return null;

	return value;
};

/**
 * Convert a (possibly raw) git URL to the filesystem-safe `project_key`
 * form. The canonical `host/path` is mapped 1:1 to `host__path` so it
 * can serve as a single path segment under
 * `$XDG_DATA_HOME/vitest-agent/`.
 */
export const gitUrlToProjectKey = (raw: string): string | null => {
	const canonical = canonicalizeGitUrl(raw);
	if (canonical === null) return null;
	return canonical.replaceAll("/", "__");
};

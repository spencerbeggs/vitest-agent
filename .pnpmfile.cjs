// Temporary bridge for the Effect 4.1 round (effected PR #1168).
//
// The build toolchain (@savvy-web/*, okfit, tsdoctor, pluginfinity) still ships
// on @effected/* releases built on Effect 4.0.7, which import `Crypto` from the
// `effect` root and die at import on 4.1. This hook runs those published
// packages, and the tools that load them, on the effect they were built on by
// turning each 4.x effect-line edge into an npm alias of 4.0.7 (an alias slips
// past the catalog plugin's graph-wide 4.1.1 override). Private workspace
// packages are left alone.
//
// Remove this file once every tool we build with has republished on an
// @effected release built on Effect 4.1; then no lockfile `packages:` entry
// names effect@4.0.7.
const BRIDGED = "4.0.7";
const TOOLCHAIN = [
	"@savvy-web/",
	"@okfit/",
	"@tsdoctor/",
	"@pluginfinity/",
	"pluginfinity",
	"@vitest-agent/",
	"rolldown-pnpm-config",
];
const isEffectLine = (name, spec) =>
	(name === "effect" || name.startsWith("@effect/")) && /^[\^~=]*4\./.test(String(spec).trim());
const reachesKit = (pkg) =>
	[pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) =>
		Object.keys(deps ?? {}).some((name) => name.startsWith("@effected/")),
	);
// Unlike the effected repo, this workspace consumes the published kit built on
// 4.1 at runtime, so a package that already declares an effect-line edge on
// 4.1 or later (the new kit's `~4.1.0` peer) is never bridged.
const builtOnNewEffect = (pkg) =>
	[pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) =>
		Object.entries(deps ?? {}).some(
			([name, spec]) => isEffectLine(name, spec) && /^[\^~=>]*4\.[1-9]/.test(String(spec).trim()),
		),
	);
function readPackage(pkg) {
	if (pkg.private === true || !pkg.name) return pkg;
	if (builtOnNewEffect(pkg)) return pkg;
	const bridged =
		(pkg.version === BRIDGED && isEffectLine(pkg.name, pkg.version)) ||
		pkg.name.startsWith("@effected/") ||
		TOOLCHAIN.some((p) => pkg.name.startsWith(p)) ||
		reachesKit(pkg);
	if (!bridged) return pkg;
	const pinned = {};
	for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
		for (const name of Object.keys(pkg[field] ?? {})) {
			if (!isEffectLine(name, pkg[field][name])) continue;
			delete pkg[field][name];
			pinned[name] = `npm:${name}@${BRIDGED}`;
		}
	}
	if (Object.keys(pinned).length > 0) pkg.dependencies = { ...pkg.dependencies, ...pinned };
	return pkg;
}
module.exports = { hooks: { readPackage } };

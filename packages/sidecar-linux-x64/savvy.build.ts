import { build } from "@savvy-web/bundler";

await build({
	meta: false,
	exe: { fileName: "vitest-agent-sidecar" },
});

import { defineConfig } from "@rspress/core";
import { ApiExtractorPlugin } from "rspress-plugin-api-extractor";

export default defineConfig({
	root: "docs",
	outDir: "dist",
	lang: "en",
	locales: [
		{
			lang: "en",
			label: "English",
		},
	],
	title: "vitest-agent",
	description:
		"A Vitest plugin, CLI, and MCP server family that gives AI coding agents structured, token-efficient test feedback and a disciplined TDD workflow.",
	themeConfig: {
		socialLinks: [{ icon: "github", mode: "link", content: "https://github.com/spencerbeggs/vitest-agent" }],
		llmsUI: {
			viewOptions: ["markdownLink", "chatgpt", "claude"],
			placement: "outline",
		},
	},
	llms: false,
	route: { cleanUrls: true },
	plugins: [
		ApiExtractorPlugin({
			siteUrl: "https://vitest-agent.dev",
			logLevel: "info",
			apis: ApiExtractorPlugin.api.fromModelsDir("./lib/models"),
		}),
	],
});

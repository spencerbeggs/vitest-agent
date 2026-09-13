#!/usr/bin/env node

/**
 * MCP server entry point for vitest-agent. Thin shim over `main.ts` — the
 * assembled program that owns the process.
 *
 * @packageDocumentation
 */

import { main } from "./main.js";

void main();

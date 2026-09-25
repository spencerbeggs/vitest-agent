#!/usr/bin/env node
import { main } from "@vitest-agent/mcp/main";
import { CURRENT_PLUGIN_VERSION } from "../version.js";

void main({ distribution: { name: "@vitest-agent/plugin", version: CURRENT_PLUGIN_VERSION } });

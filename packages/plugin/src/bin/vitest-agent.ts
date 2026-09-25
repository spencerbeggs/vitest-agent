#!/usr/bin/env node
import { main } from "@vitest-agent/cli/main";
import { CURRENT_PLUGIN_VERSION } from "../version.js";

main({ distribution: { name: "@vitest-agent/plugin", version: CURRENT_PLUGIN_VERSION } });

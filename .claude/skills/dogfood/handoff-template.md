---
chain: {chain-slug}
chain_index: 01
title: {title-slug}
status: open
created: {ISO-8601}
parent_session: {chat_id of the agent writing this}
prev_handoff: null
what_were_testing: {one sentence describing the system aspect under observation — orchestrator behavior, channel resolution, hook denial, MCP tool surface, etc.}
---

## Task for the TDD orchestrator

{The sanitized task prompt the orchestrator will receive. Describes a playground-level problem in concrete terms — files, function names, expected behavior, expected error type. Never references the meta-goal, never names the cheatsheet, never says "we suspect X".}

## What the orchestrator MUST NOT know

- That this entire dogfood session is checking {meta-goal}.
- {Any specific hint that would telegraph what we're watching for.}

## Optional extra-reporting asks

{Default: None. Default reporting only. Use only when the meta-goal genuinely requires extra structured output from the orchestrator — and even then, frame it as part of the task, not as an audit request.}

## Verification checklist (for the main agent after orchestrator completes)

- {Checklist items specific to this experiment, in addition to the standard seven-step audit.}

## Known issues this session

{Bullet list of things already surfaced earlier in the chain, or "None — first handoff in chain."}

## System changes already attempted

{Bullet list of changes made during this session in response to findings, or "None yet."}

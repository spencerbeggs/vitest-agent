# Measurement

* [Reporter and ui import module counts](reporter-import-module-counts.md) - How many modules Node loads to import @vitest-agent/reporter and the @vitest-agent/ui root, and how many of them are React or Ink, before and after the Ink half moved behind @vitest-agent/ui/ink and the reporter's two lazy view loads (issue 562).
* [Sidecar hook latency](sidecar-hook-latency.md) - A qualitative order-of-magnitude comparison of PreToolUse Bash hook latency across the three-layer sidecar fix's code paths, measured with scripts/bench-sidecar.sh.

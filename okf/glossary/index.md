# Glossary

* [Carrier](carrier.md) - The repository-specific term for @vitest-agent/plugin's role as the one package a consumer installs and the sole declarer of both family bins.
* [Executor vs. console mode](executor-and-console-mode.md) - "Executor" is a detected fact about who is running the tests (human/agent/ci); "console mode" is a resolved output-behavior value looked up per executor. The two use the literal string "agent" for unrelated things.
* [Reporter](reporter.md) - Three unrelated senses of "reporter" collide in this codebase: the pre-2.0 whole system, Vitest's own reporter-class API, and this repository's rendering-only \`@vitest-agent/reporter\` package.
* [Test kind vs. Vitest tag](test-kind-vs-tag.md) - "Test kind" (unit/int/e2e) is a filename-derived classification this repository invents and injects as a Vitest tag at collection time; it is not something Vitest itself understands or a test declares.
* [chatId, sessionId, tddTaskId](chat-session-tddtask-ids.md) - Three-tier agent-facing identifier naming: chatId is the host's rotating per-process id, sessionId is the SQLite agent-run row, and tddTaskId is one TDD orchestration task. Replaces the earlier ccSessionId/tddSessionId vocabulary.

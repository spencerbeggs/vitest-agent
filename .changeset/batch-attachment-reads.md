---
"@vitest-agent/engine": patch
---

## Performance

* `DataReader` now reads a test's annotation and artifact attachments with one query per call instead of one query per annotation or artifact, so a test that records many annotations no longer multiplies database round trips (#395).

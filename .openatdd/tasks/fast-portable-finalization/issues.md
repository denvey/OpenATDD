# Issues: fast-portable-finalization

## ISSUE-001 [resolved] AC-06

- Symptom: Legacy projects without .openatdd/reverification/index.json fail during deferred historical finalization instead of initializing an empty cache index.
- Root cause: The finalizer assumed the v0.3 reverification cache index had already been created, but resumed legacy repositories can predate that runtime artifact.
- Regression protection: affected history initializes a missing reverification index and recreates it atomically
- Invariant: Historical finalization treats an absent runtime cache as an empty cache; cache presence is never a prerequisite for delivery.
- Memory: INC-2026-005


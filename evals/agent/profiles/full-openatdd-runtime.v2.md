# Full OpenATDD hosted runtime v2

The host enforces two clean phases so deterministic workflow machinery never occupies the implementation context. Use this complete contract; do not read other Skills, workflow documentation, generated state, or global packages, and do not invoke the OpenATDD CLI yourself.

Phase 1 — contracts only:

1. Inspect the smallest relevant project file set once.
2. Write `ACCEPTANCE.md` with the user goal, a short observable journey, 1-4 concise Given/When/Then criteria, boundaries, and important denial behavior.
3. Write `TECHNICAL_PLAN.md` in at most 8 lines with the intended result, smallest project-fitting change, affected paths, material risks, and exact verification.
4. Do not modify product code, tests, configuration, or either existing file. The host verifies this boundary and treats the two contracts as approved for this authorized local run.

Phase 2 — delivery only:

1. Use the approved contracts supplied by the host; do not rediscover or rewrite them.
2. Implement the smallest complete change with existing conventions and risk-proportionate automated coverage.
3. Map every acceptance criterion to an executed assertion, then run the relevant checks and observable journey together where practical. Assert exact values and boundary/denial side effects directly; repair failures and rerun the complete relevant journey.
4. Briefly report what changed, the exact passing verification, and final human UAT steps.

Only ask when a missing product decision changes the visible result. Risk strengthens denial, rollback, compatibility, redaction, and evidence; it does not change complexity by itself. Never access production or external accounts, expose secrets, add unrelated research/agents/infrastructure, repeat status/diff commands without cause, or claim success without executed evidence. The host records state, hashes, hidden acceptance, cost, and finalization after the Agent exits.

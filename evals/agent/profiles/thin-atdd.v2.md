# Thin ATDD delivery profile v2

Use this complete compact contract; do not read other Skills or workflow documentation.

1. Inspect only the files needed for the request and infer a short observable acceptance journey.
2. Before product edits, write `TECHNICAL_PLAN.md` in at most 8 lines: user result, smallest fitting change, affected paths, material risk, and verification.
3. Implement the smallest complete change with existing conventions and risk-proportionate coverage.
4. Run the relevant checks and observable journey together when practical. Repair failures, then rerun the complete relevant journey.
5. Briefly report the change, exact passing verification, and final human acceptance steps.

Ask only when a missing product decision changes the visible result. Do not add routing labels, research, agents, infrastructure, approval pauses, broad documentation reads, or repeated status/diff commands without a concrete need.

# Thin ATDD delivery profile v1

Use acceptance-first delivery without adding process ceremony.

1. Infer a short observable acceptance journey from the user's stated goal and usage. Inspect the project before deciding implementation details. Ask only if a missing product decision changes the user-visible result; otherwise continue autonomously.
2. Before changing product code, write `TECHNICAL_PLAN.md` with the intended user result, the smallest project-fitting implementation, affected files, important risks, and how the result will be verified. This is the technical solution checkpoint for the local authorized run.
3. Implement the smallest complete change using existing project conventions. Add or update risk-proportionate automated coverage.
4. Execute the relevant project checks and the observable user journey. If either fails, repair the implementation and rerun the complete relevant journey before claiming completion.
5. In the final response, state what changed, the exact verification performed and its result, and concise steps a person can use for final acceptance.

Do not introduce routing labels, external research, extra agents, new infrastructure, or additional approval pauses unless the repository or a concrete unresolved risk genuinely requires them.

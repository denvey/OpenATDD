# Verification routing

Prefer the narrowest deterministic verifier that observes the approved result.
Use the task lane to scale breadth, not to weaken evidence: Quick favors one
direct local path, Standard adds cross-module boundaries, and Deep adds
independent and risk-specific verification. Load the `verification` view from
the task's scoped context; do not reuse implementation assumptions as proof.

| Surface | Primary verifier | Typical evidence |
|---|---|---|
| Business rule | Unit or domain test | Test output and focused assertions |
| Service interaction | Integration test | Logs, responses, persisted state |
| API and permissions | HTTP client or project API tests | Sanitized request/response |
| Web user journey | Playwright or browser controller | Screenshots, DOM facts, network result |
| Database outcome | Read-only query or repository API | Sanitized rows or counts |
| XLSX/CSV/PDF | Format-aware parser | Parsed values, totals, page/row counts |
| CLI | Real process execution | Exit code, stdout/stderr, created files |
| Complex visual canvas | Visual AI only when deterministic access is insufficient | Image plus explicit human judgment |

## Evidence rules

- Capture evidence after solution approval and after the latest relevant repair.
- Store local evidence in the task's Git-private `tasks/<task>/evidence/` directory.
- Remove secrets, tokens, personal data, and unsafe production payloads.
- Record failed observations as failures; never overwrite them into passes.
- After a repair, rerun the failed item, affected items, relevant automated
  checks, and the complete approved main journey.
- For historical affected tasks, produce evidence newer than the solution that
  caused the impact.

## Browser verification

Use real roles and realistic data where safe. Check visible state and, when
important, API or persisted state. Avoid declaring success from screenshots
alone when structured assertions are available.

Before opening the browser, require a passing `preflight.json` and validated
`uat-plan.json`. Prefer three cohesive batches when the journey allows it:

1. setup, entry, and login;
2. the primary business journey;
3. final readback and evidence.

Reuse the same authenticated session. Read DOM state and capture screenshots at
meaningful checkpoints or failure, not after every click. A failed batch can be
narrowed during diagnosis, but after repair all formal batch and acceptance
evidence must be recaptured in the new verification epoch.

## Efficient check order

- `focused`: affected tests during implementation and each small repair;
- `module`: the relevant subsystem after repairs close;
- rehearsal: `openatdd finalize <task> --dry-run` against real entry points,
  without formal evidence or historical reruns;
- `broad`: the full risk-proportionate suite once inside formal finalization
  after the complete source fingerprint is frozen;
- approved journey: one complete command-backed journey in the same formal operation;
- history: one affected-history pass after current acceptance succeeds.

Successful formal verification enters `DELIVERED`. Automatic and API evidence
is presented without asking the person to repeat it. Blocking `ASSISTED` and
`MANUAL` criteria remain as human UAT steps; passing requires no reply, while an
objection enters the existing issue and repair flow.

If the rehearsal fails, return to focused repair and rehearse again. If a
post-freeze failure or source mutation occurs, use the issue flow, advance the
epoch, and execute one new complete finalization. Do not preserve partial formal
passes across fingerprints.

Duration and browser-round-trip budgets produce warnings only. They are a
signal to improve batching or environment memory, never a reason to weaken
coverage or fail acceptance by elapsed time alone.

## External blockers

Use `blocked` for unavailable credentials, services, permissions, CAPTCHA,
hardware, production authorization, equivalent external state, or three
recorded no-progress attempts without a new credible hypothesis. Ordinary
implementation errors and failing tests belong in the repair loop. A new
credible hypothesis resumes repair from the persisted recovery boundary.

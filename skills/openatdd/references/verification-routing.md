# Verification routing

Prefer the narrowest deterministic verifier that observes the approved result.

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
- Store local evidence in `.openatdd/tasks/<task>/evidence/`.
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

## External blockers

Use `blocked` only for unavailable credentials, services, permissions,
CAPTCHA, hardware, production authorization, or equivalent external state.
Ordinary implementation errors and failing tests belong in the repair loop.

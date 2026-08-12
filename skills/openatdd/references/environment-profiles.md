# Project environment profiles

OpenATDD keeps reusable, non-secret UAT facts in
`.openatdd/environments/<name>.yaml`. The format is intentionally a strict flat
YAML subset so the Skill remains dependency-free. Nested maps, YAML tags,
anchors, aliases, blocks, and unknown keys are rejected.

## Safe division of data

- Profile YAML: workspace, surface, commands, URLs, version, role or
  organization labels, fixture and integration references, known workarounds,
  credential **variable names**, sources, and `last_verified_at`.
- `.env.openatdd.local`: real local-only test values. This file is generated as
  a Git-ignore rule and must never be committed.
- `.env.openatdd.example`: the same variable names with empty values; safe to
  commit.
- `observations.json`: evidence-backed current observations plus stale history.

Never store a password, token, secret, API key, private key, or production
credential in profile YAML, cards, task state, memory, reports, logs, or
evidence. `.env.openatdd.local` accepts only `NAME=value`; interpolation,
command substitution, `export`, redirects, pipes, and shell operators are
forbidden. Runtime values are redacted and persisted artifacts are scanned.

## Maintain verified facts

Record a changed fact only with a non-secret evidence file:

```bash
openatdd observe-env local --key entry_url \
  --value "http://127.0.0.1:3000" \
  --source "local startup output" \
  --evidence /absolute/path/to/sanitized/startup.txt
```

When a value changes, OpenATDD preserves the old observation in stale history
instead of silently deleting it. `openatdd memory <query> --json` returns only
incident and environment observations relevant to the query.

For credential references, record uppercase variable names only:

```bash
openatdd observe-env local --key credential_variables \
  --value "OPENATDD_TEST_USERNAME, OPENATDD_TEST_PASSWORD" \
  --source "local UAT account contract" --evidence <safe-file>
cp .env.openatdd.example .env.openatdd.local
```

Fill the local file yourself or through an already-authorized local secret
workflow. Do not put secret values in a command argument or model-visible text.

## Automatic preflight

Preflight checks the workspace, project identity, version, service URLs, entry
URL, required environment variables, and fresh project-specific assertions for
login, role or organization, integration, fixture, and known workarounds.
Failed checks are persisted as an actionable list and browser UAT cannot start.
Successful preflight refreshes the profile source and `last_verified_at`.

Each applicable project-specific assertion must be `passed` and cite fresh,
sanitized evidence newer than the current verification boundary:

```json
{
  "login": {
    "status": "passed",
    "summary": "Tester reached the expected workspace",
    "evidence": "/absolute/path/to/sanitized/login.txt"
  },
  "organization": {
    "status": "passed",
    "summary": "qa-org is active",
    "evidence": "/absolute/path/to/sanitized/login.txt"
  }
}
```

Pass this file with `openatdd preflight <task> --assertions <file>`. The file
must not contain account values or tokens.

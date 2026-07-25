# Fast finalization

Use this reference after the acceptance and solution cards are approved and
implementation repairs are complete. The portable default is:

```text
focused implementation and repair
→ finalize --dry-run
→ repair every rehearsal finding
→ freeze the complete source fingerprint
→ finalize
→ human UAT from report.md
```

This does not add a third approval. The person still confirms only the
acceptance card and solution card; the two finalization commands are executed
by the agent.

## Project manifest

Store the versioned contract at `.openatdd/finalization.json`. Commands are
always argv arrays and run without a shell. A minimal CLI example is:

```json
{
  "schemaVersion": 1,
  "surface": "cli",
  "environment": "local",
  "source": { "include": ["**/*"], "exclude": ["dist/**"] },
  "dryRun": {
    "commands": [
      { "id": "help-smoke", "argv": ["node", "bin/app.mjs", "--help"] }
    ],
    "checkHttpLinks": false
  },
  "checks": [
    {
      "id": "focused",
      "scope": "focused",
      "commands": [{ "id": "focused-tests", "argv": ["npm", "test", "--", "feature"] }]
    },
    {
      "id": "module",
      "scope": "module",
      "commands": [{ "id": "module-tests", "argv": ["npm", "run", "test:module"] }]
    },
    {
      "id": "broad",
      "scope": "broad",
      "commands": [{ "id": "all-checks", "argv": ["npm", "run", "check"] }]
    }
  ],
  "uat": {
    "estimatedRoundTrips": 3,
    "batches": [
      {
        "id": "journey",
        "name": "Complete approved journey",
        "acceptanceIds": ["AC-01"],
        "commands": [{ "id": "uat-journey", "argv": ["npm", "run", "uat"] }],
        "reuseSession": true
      }
    ]
  },
  "acceptance": {
    "AC-01": ["check:broad", "batch:journey"]
  },
  "history": { "mode": "deferred", "overrides": [] },
  "handoff": { "estimatedMinutes": 8 },
  "budgets": {
    "wallTimeMs": 300000,
    "commandInvocations": 8,
    "browserRoundTrips": 3,
    "evidenceWrites": 20
  }
}
```

Rules enforced by the validator:

- `surface` is `cli`, `api`, `web`, `file`, or `mixed`;
- `environment` names a non-secret profile in `.openatdd/environments/`;
- every command has a unique lowercase ID and non-empty `argv` array;
- working directories stay inside the project and timeouts are positive;
- check groups are ordered `focused → module → broad`, with exactly one broad
  group;
- one to five cohesive UAT batches cover every acceptance criterion;
- every acceptance ID maps to an existing check or batch evidence reference;
- historical overrides explicitly map every affected legacy acceptance ID;
- budgets warn about avoidable repetition but never fail solely due to elapsed
  time.

The resolved manifest is copied into the task only during successful formal
finalization. Existing granular OpenATDD commands remain available.

## Surface adapters

- CLI: invoke the real executable with representative options and verify exit
  code, output, and created files.
- API: start or reuse the authorized local service, call real endpoints, and
  capture sanitized response plus persisted outcome.
- Web: put setup/login, the primary journey, and final readback into up to three
  cohesive scripts; reuse the authenticated session.
- File: invoke the real exporter/importer, then parse the result with a
  format-aware verifier.
- Mixed: use separate batches only where the observation boundary changes;
  map each acceptance ID to all evidence needed for the outcome.

Never infer production-safe commands. Manifests describe already authorized
local, staging, or disposable operations.

## Rehearsal

Run:

```bash
openatdd finalize <task> --dry-run
```

Add `--manifest <path>` only to try a project-contained alternate manifest and
`--assertions <safe-json>` when the environment profile requires fresh login,
organization, integration, fixture, or workaround evidence.

The rehearsal checks the real entry points, non-persisting environment
preflight, UAT coverage, report rendering, local and applicable HTTP links,
credential redaction, and source stability. It writes preview diagnostics but
does not record a pass, advance the verification epoch, reverify history,
generate a notification, or enter READY.

Common diagnostics:

- `INVALID_FINALIZATION_MANIFEST`: fix all reported schema and mapping errors;
- `PREFLIGHT_FAILED`: correct the workspace/profile or supply fresh sanitized
  assertion evidence;
- `FINALIZATION_COMMAND_FAILED`: inspect the named preview log, repair, then
  rerun the rehearsal;
- `INVALID_HANDOFF` or `INVALID_HANDOFF_LINK`: fix report metadata or target;
- `SECRET_LEAK`: remove the local value from persisted content; keep only the
  variable name;
- `SOURCE_CHANGED_DURING_DRY_RUN`: stop mutating deliverables in rehearsal or
  wait for the implementation to stabilize.

## Freeze and formal run

After a green rehearsal and all repairs:

```bash
openatdd finalize <task>
```

The source fingerprint covers sorted tracked, modified, and untracked
deliverables, including mode, size, and content digest. Git metadata, local
credentials, dependency/build caches, transactions, runtime evidence, reports,
and reverification cache are always excluded. The manifest and non-secret
environment profile remain protected by their own digests and normally belong
to the source inventory.

Formal finalization creates a clean verification epoch in memory, executes the
groups and batches, verifies captured evidence and secrets, prepares the human
handoff, reverifies affected history once, and validates the projected READY
state. Only then does a recoverable multi-file transaction commit historical
states first and the current READY state last. A failed command or validation
may leave diagnostic logs, but never a partially passed formal state.

Running the same command again with the same completed fingerprint is an
idempotent cache hit. A deliverable, manifest, or profile change makes the
preview stale and requires another rehearsal. A post-freeze product defect uses
the normal issue/root-cause/regression/invariant flow before one new complete
final run.

## Historical tasks

Newly finalized tasks store a secret-free replay snapshot. For an affected
task with a snapshot, finalization replays the stored broad contract once for
the current fingerprint. Legacy tasks require a manifest override:

```json
{
  "taskId": "legacy-export",
  "acceptanceIds": ["AC-01", "AC-02"],
  "evidenceFrom": ["check:broad", "batch:journey"]
}
```

Do not add a blanket override without verifying that the referenced evidence
actually covers every listed historical criterion.

## Manual fallback

If no valid manifest exists, use the granular sequence documented in
`SKILL.md`: preflight, pre-UAT planning, checks, batches, acceptance records,
handoff, and ready. Use granular commands for diagnosis, but do not repeat them
after a successful formal finalization for the same fingerprint.

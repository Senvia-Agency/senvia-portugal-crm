# Automation workflow shared contract evidence

## Scope

- Added only `supabase/functions/_shared/automation-workflow-contract.ts` and its adjacent test.
- No engine, UI, Otto, migration, production data, deployment, or external message changed by this lane.

## Binary verification

Command:

`deno check supabase/functions/_shared/automation-workflow-contract.ts`

Observable: exit code 0 and `Check ...automation-workflow-contract.ts`.

Command:

`bun test supabase/functions/_shared/automation-workflow-contract.test.ts`

Observable: exit code 0, 7 pass, 0 fail, 21 assertions.

Covered scenarios:

- Editable draft permits zero stages; executable definition requires at least one.
- Per-stage cadence defaults to `once`.
- Daily IANA schedule, declared native event, and authenticated manual triggers parse; invented event and invalid timezone fail.
- Entity field catalog rejects unknown fields, incompatible operators, and filters whose fields are absent from projection.
- Organization/owner scope parses separately from the workflow definition.
- Stage action node references validate against graph node IDs.
- Relative date comparisons are deterministic.
- Datetime fields require timestamp values and compare against the tenant civil day, including a New York UTC boundary.
- Receivable IDs use an explicit source prefix; other entity IDs remain UUIDs.

## Additional audit

`git diff --check` passed for both files. The bundled no-excuse script could not run because its own plugin directory could not resolve the repository's `typescript` package; a direct textual audit found no forbidden `any`, assertions, suppression comments, non-null assertions, or TypeScript enum declarations. TypeScript LSP was unavailable because installation had previously been declined, so Deno's checker is the type-check evidence for the shared runtime file.

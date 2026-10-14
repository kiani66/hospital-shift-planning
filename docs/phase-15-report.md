# Phase 15 implementation checkpoint — NOT ready for merge

The feature branch starts at main `343e21ad962b699d1fc4c8df115c7710d75b099f`, verified using
GitHub after sandboxed git fetch could not connect. The actual attached NICU workbook was
inspected during preflight; no actual identity or schedule data was imported or committed.

## Changes written

- SECRETARY membership, CSV normalization, manual management/filter controls, Persian role
  labels, schedule roster summaries and migration 0015 (additive enum only).
- Nursing-only coverage in working-copy validation, review, live editor, change assessment,
  candidate reads/writes and nurse replacement selection. Full roster completeness and
  secretary personal scheduling/rest/workload/publication semantics remain on existing paths.
- Standard XLSX parser/template generator, original ISO periods, dated identity/membership
  checks, consistent previews, signed actor/purpose/rows/period proofs, expiry and transactional
  commit with revalidation, protected-history/occupied-schedule refusal, plain assignment
  inserts, existing schedule exclusion/primary-key protections and import audit summary.
- Persian department import page, month-specific blank/sample template downloads, RTL grid,
  separate import blockers and normal schedule findings, confirmation and schedule link.
- Sanitized standard and print-layout fixtures, unit/integration/E2E tests, D119–D121,
  database documentation and Persian operator instructions.

## Verification observed in this environment

| Command/check                                      | Result                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ESLint                                             | Passed after fixing the new route link and keeping calendar tests in presentation.                      |
| Unit tests excluding the unavailable XLSX suite    | 97 files / 1,987 tests passed. This is a diagnostic partial run, not full acceptance.                   |
| Domain coverage in that partial run                | 100% statements, branches, functions and lines; existing thresholds unchanged.                          |
| `pnpm check`                                       | Blocked at typecheck by unavailable exceljs/fflate modules and their missing inferred types.            |
| Full `pnpm test` before the final label correction | 1,981 passed; the old role-label expectation needed SECRETARY and was fixed; XLSX suite could not load. |
| `pnpm build`                                       | Failed to resolve exceljs/fflate.                                                                       |
| `pnpm test:integration`                            | Setup failed before tests: EPERM connecting to local PostgreSQL (localhost hsp_test).                   |
| `pnpm test:e2e`                                    | Production server could not start; no browser acceptance run completed.                                 |
| `pnpm test:e2e:reset`                              | Sandbox refused tsx's local IPC socket; no reset test ran.                                              |
| Offline lockfile resolution                        | No cached exceljs metadata; lockfile cannot be regenerated offline.                                     |

Package registry access was blocked by the execution sandbox. Both scoped network requests and
an explained escalation did not complete and were interrupted. No rejection reason beyond the
observed sandbox EPERM was supplied. Do not misreport these as product test failures or passes.

## Required before merge

1. In an environment with registry access, run `pnpm install` with Node 22 / pnpm 10.33 and commit
   the generated `pnpm-lock.yaml`. `package.json` declares exceljs 4.4.0 and fflate 0.8.2; the lock
   is intentionally NOT invented and is currently stale.
2. Re-run typecheck and the XLSX suite with the actual dependency types/runtime, fixing any
   issues they uncover. The new parser, import transaction and UI tests are written but unverified.
3. Migrate only an isolated local/test database; run all mandatory checks, full unit/domain
   coverage, integration, build, E2E and isolated reset E2E. No threshold/test/control was weakened.
4. Review short SHARE table-lock latency, archive limits and cross-schedule races under the real
   PostgreSQL suite. Confirm secretary min/max/candidate/replacement behavior end-to-end.
5. Prepare the real NICU workbook in the standardized template with verified personnel numbers
   and dated memberships, including the secretary through the authorized personnel workflow.
   Validate its preview with the Head Nurse. Importing real data requires separate authorization.

No merge, Production deployment, real data import, operational reset, Production migration or
seed was performed. This checkpoint remains a draft until the blocked work is completed.

# Head Nurse pilot UI polish — scopes 1–7

All seven scopes are implemented. Scheduling rules, permissions, workflow transitions, roster persistence, shift meanings, and autosave remain unchanged. Verification used isolated fixtures in local/test databases; production data was not accessed or modified. This change is for PR review, without merging or production deployment.

## Verified findings and changes

| Scope                  | Finding / root cause                                                                                                                                            | Implemented change                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Schedule workspace  | Month diagnostics, workflow blockers, and the empty-assignment notice occupied separate repeated sections.                                                      | One monthly summary contains the workflow notice and empty state. Blocking reasons stay visible; expandable details expose affected days and reasons, including draft days. Existing problem-day filters and finalization/submission guards remain intact.                                                                                                 |
| 2. Head Nurse overview | The home page mainly offered navigation cards.                                                                                                                  | Authorized application queries supply a department/period/status card, existing validated ready-day progress, and Continue Planning. Period selection uses the same current/upcoming/latest logic as the schedule page. Missing schedules have an explicit Persian action; the existing read-error boundary handles unavailable data.                      |
| 3. Personnel counts    | Schedule personnel are a retained period roster; the people page reads memberships effective today. These counts need not match.                                | Precise Persian labels, an effective date and current count, and an explanation distinguish the sources. No automatic roster reconciliation. An isolated regression reproduces five retained roster entries versus four current members after one membership ends.                                                                                         |
| 4. Daily editor        | Calendar day opening and autosave already worked. Icon-only day navigation was less discoverable, and a range draft could disappear when navigating or closing. | Visible previous/next labels, a mobile header with room for the title/close action, editor-first mobile ordering, and consistent shift/range controls. Pending writes block leaving; an open range form requires discard confirmation. Rejected confirmations retain the form. Existing errors now identify the requested nurses and first requested date. |
| 5. Responsive polish   | A long roster-addition button overflowed by 25px at 320px. Repeated coverage detail and crowded daily controls reduced mobile usability.                        | Wrapping roster-addition labels, a three-column mobile shift grid with a full-width range action, and expandable detailed coverage for editable days. Existing live coverage and all diagnostic categories remain available.                                                                                                                               |
| 6. Sidebar toggle      | A full-width control permanently displayed the collapse label.                                                                                                  | Existing panel icons in a compact 44px header control. Dynamic Persian accessible labels and tooltips, token-based hover/focus/active states, retained desktop rail/mobile drawer behavior, and Escape-dismissable tooltips.                                                                                                                               |
| 7. My Shifts alignment | Flexible wrapping placed the long ME shift/status differently from shorter labels.                                                                              | All mobile rows use the same two-line grid: date/shift, then hours/status. Larger screens use predictable columns. Labels, colors and statuses are preserved; no font-size workaround.                                                                                                                                                                     |

### Count semantics

The schedule roster query reads persisted roster entries joined to users; it does not filter those entries by current membership or active account status. Initial roster creation uses active accounts with effective memberships intersecting the schedule period. The current-members query instead filters memberships by today's inclusive effective dates, excludes future/ended memberships, and includes inactive accounts with their existing status indication. Supervisors are displayed separately.

The earlier exact **18 versus 17** observation was not independently audited against production records. The sources support a valid difference, and the local **5 versus 4** regression verifies that behavior without changing the domain.

### Editing and validation

A day is ready only according to existing monthly validation: assignments alone are insufficient. The overview regression uses a schedule with assignments on all days and a night-rest violation: **29 of 30** days are ready and finalization remains disabled. Blocking errors retain textual reasons and icons; advisory preference mismatches keep their existing separate presentation.

Daily navigation retains the URL-driven modal and optimistic autosave queue. E2E verification covers opening a calendar day, assigning a shift, waiting for server confirmation, moving to the next day, blocking movement/Escape during a delayed write, and rejecting/accepting range-draft discard confirmation.

## Validation

- Production build passed.
- Required `pnpm check`: lint, TypeScript, formatting, and **1,928 unit tests in 92 files** passed.
- Relevant integration checks: **100 tests** passed.
- Broad Chromium E2E run across seven relevant specs: **85 passed, 13 intentional skips, 2 failures**. The failures identified the removed accessible note role on the empty-assignment notice; that role was restored.
- Final focused Chromium rerun: **12/12 passed**, including both failed cases and the overview, roster distinction, draft detail, and pending-write/range-discard flows. Across these runs, all **87 executable cases** from the broad suite passed after the fix.
- Desktop and Android-emulated Chromium verified. Screens checked at **1440×900, 390×844, 320×700**. My Shifts additionally checked at **320, 375, 390, 430px**.
- No horizontal overflow in the final captured screens. Mobile agenda row content is consistently 66px; desktop rows are 44px. Sidebar mobile targets are at least 44px.
- Final diff reviewed for unrelated changes; no dependencies, database schema, permission, or domain-rule changes.

## Before / after screenshots

Reviewer samples below use the same isolated fixture and 390×844 viewport. Full-page screenshots show the complete page; the daily editor uses a viewport screenshot after its opening animation finishes.

| Screen              | Before                                                            | After                                                           |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Head Nurse home     | [Before](screenshots/head-nurse-pilot/before-overview-mobile.png) | [After](screenshots/head-nurse-pilot/after-overview-mobile.png) |
| Department schedule | [Before](screenshots/head-nurse-pilot/before-schedule-mobile.png) | [After](screenshots/head-nurse-pilot/after-schedule-mobile.png) |
| Daily editor        | [Before](screenshots/head-nurse-pilot/before-editor-mobile.png)   | [After](screenshots/head-nurse-pilot/after-editor-mobile.png)   |

Additional reviewer samples:

- My Shifts: [320px before](screenshots/head-nurse-pilot/shifts-before-320.png) / [after](screenshots/head-nurse-pilot/shifts-after-320.png); [390px before](screenshots/head-nurse-pilot/shifts-before-390.png) / [after](screenshots/head-nurse-pilot/shifts-after-390.png).
- Sidebar: [expanded](screenshots/head-nurse-pilot/sidebar-expanded.png), [collapsed](screenshots/head-nurse-pilot/sidebar-collapsed.png), [mobile open](screenshots/head-nurse-pilot/sidebar-mobile-open.png), [mobile closed](screenshots/head-nurse-pilot/sidebar-mobile-closed.png).

Full local screenshot sets:

- `/workspace/artifacts/pilot-ui/{before,after}-{overview,schedule,people,empty,editor}-{desktop,mobile,narrow}.png` — 30 captures. `empty` is the empty draft month; missing schedules/months are also covered by E2E tests.
- `/workspace/artifacts/shift-alignment/{before,after}-{320,375,390,430}.png` — mobile agenda comparisons.
- `/workspace/artifacts/shift-alignment/sidebar-{expanded,collapsed,mobile-open,mobile-closed}.png` — desktop and mobile sidebar states.

For scopes 1–5, the before screenshots use the original committed implementation with the scope 6–7 controls applied, matching the incremental baseline. That baseline was rebuilt in a temporary isolated worktree and removed after capture. The fixture and business state are the same before and after.

## Limitations

- Initial verification used Chromium desktop and Android emulation. WebKit was added for the CI follow-up below; physical-device testing remains unperformed.
- This environment runs Node 24 / pnpm 11 rather than the repository's declared Node 22 / pnpm 10. The package manager reported the expected version warning; checks and build succeeded with existing dependencies. No lockfile or package version changes were made.
- The specific historical production count difference remains unaudited, as described above.

## CI follow-up

[CI run 38137089416](https://github.com/kiani66/hospital-shift-planning/actions/runs/38137089416/job/114468404504) completed the build, lint/type/unit, integration, and isolated-reset jobs successfully, but its full E2E suite reported 14 failures (473 passed, 42 skipped). Three existing E2E files omitted from the initial targeted run still assumed the old presentation:

- Coverage assertions tried to read a region inside closed details. They now open the coverage details and retain the same staffing/revision assertions.
- Mobile control tests required five codes on one row. They now verify the consistent M/E/N and ME/OFF/clear rows, a full-width range action, unclipped labels, and 44px mobile targets. The original desktop single-row assertion remains. A 320px case was added.
- The 768px layout test expected preference diagnostics above the list. It now verifies the editor-first layout below the desktop side-column breakpoint; the wide-screen RTL side-column assertion remains.

No application behavior or CI configuration was changed in this follow-up. Chromium reruns of these three files passed all 51 executable cases (7 intentional skips) across the broad run and final 8/8 grid rerun.

WebKit/iOS emulation rerun of the same three files passed **24 tests with 5 intentional skips**. The locally downloaded browser uses extracted Debian shared libraries in its browser cache; no application dependency or CI configuration was modified. Physical devices remain untested. Final `pnpm check` passed again, including all 1,928 unit tests.

# Phase 7c — Schedule UI/UX refinement: audit and plan

Status: **audit and plan only; implementation not started.** Phase 7b (schedule editing) is not
on `main`: history ends at Phase 7a (#8) plus user provisioning (#9), no branch or pull request
contains editing, and D46 states that Phase 7a writes nothing. Per the Phase 7c brief, the future
editing UI is not invented here, and implementation waits for an explicit go-ahead.

No reference mockup came with the task. §6 lists what to take from one, and what to reject,
once it arrives.

## 1. How the audit was done

- Read `AGENTS.md`, `docs/decisions.md` (D1–D47), the schedule page, `features/schedule-review/*`,
  `features/schedule/*`, `features/shifts/catalog.ts`, `features/calendar/*`, the shell,
  `components/ui/*`, `globals.css`, the review query (`application/schedules/review.ts`) and
  `tests/e2e/schedule-review.spec.ts`.
- Ran a production build (`pnpm build && pnpm start`) against a local PostgreSQL 16 with realistic
  data: one ward with a Head Nurse and 27 nurses, Aban 1405 planned for 22 of its 30 days on a
  rotating M/M/E/E/N/off/off pattern, three days with night-rest findings (including N→ME), and
  preferences on one day. That data was a scratch fixture and is not committed.
- Took screenshots at 1920×1080 (large desktop), 1366×768 (laptop), 1024×1366 (tablet, touch),
  Pixel 7 and iPhone 14 viewports, in five states: month, day needing attention, valid day,
  unplanned day and empty month. Only Chromium is installed in this environment, so the iPhone
  pass used the iPhone 14 viewport in Chromium. The WebKit (`mobile-ios`) project still has to
  run in CI.

## 2. UI/UX audit

Categories: **IH** information hierarchy · **INT** interaction · **VIS** visual design ·
**RSP** responsive · **RTL** · **A11Y** accessibility · **CON** consistency · **PERF**
performance risk.

### Page level and header

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Cat.     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| P1  | **Three stacked boxes compete before any data appears:** the page header (title and a generic description), an orphan «برنامه ماهانه جدید» button on its own row, a summary card (month, range, status), then the calendar card, which repeats the month («مرور ماهانه / آبان ۱۴۰۵»). The month is shown twice and the lifecycle status sits alone at the far end of a mostly empty card. On a 1366×768 laptop the first calendar row starts about 530 px down. | IH, VIS  |
| P2  | **The next meaningful action is buried.** For a DRAFT schedule the next step is «باز کردن ثبت ترجیحات», but it sits at the bottom of the page under the calendar, off-screen at every viewport tested. «برنامه ماهانه جدید», a rare action, is the most prominent control above the calendar.                                                                                                                                                                   | IH       |
| P3  | **Month navigation, schedule lifecycle and "create another month" are not separated.** The create button sits above the summary card, the month switcher is inside the calendar card, and the status is in the summary card.                                                                                                                                                                                                                                    | IH       |
| P4  | **The status badge is misleading:** every status other than DRAFT uses the same `CircleCheck` icon and the same primary tone, so PLANNING, RETURNED and APPROVED look alike, and a "check" suggests the schedule is done.                                                                                                                                                                                                                                       | VIS, CON |
| P5  | **The page description is boilerplate** («مرور ماهانه برنامه، فهرست پرسنل و مدیریت ثبت ترجیحات پرستاران.»). It does not say whether the schedule is editable, or read-only as in Phase 7a.                                                                                                                                                                                                                                                                      | IH       |
| P6  | **The preference-window state is only in the bottom card.** Whether preference collection is open (and until when) is key context for the month, but it is not visible near the calendar.                                                                                                                                                                                                                                                                       | IH       |

### Calendar

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                             | Cat.      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| C1  | **Health drives the loudest visual in every cell.** Each cell has a tinted background and a 4 px colored start border for all three states. With a mostly planned month, about 19 of 30 cells are green-tinted with thick green edges, so VALID, the least actionable state, dominates the grid and reads as "all good / staffed". Attention days are only slightly warmer. This is the opposite of the intended emphasis and weakens D40 visually. | VIS, IH   |
| C2  | **The data is the smallest text in the cell.** The M/E/N coverage counts, the reason to scan the calendar, are 0.65 rem chips at the bottom. Meanwhile the cell's middle is empty space and the health label repeats «بدون ایراد» 19 times.                                                                                                                                                                                                         | VIS, IH   |
| C3  | **Coverage counts vanish below 1280 px** (`max-xl:hidden`), so a 1024 px tablet, or a 1280 px laptop with the sidebar open, shows no staffing numbers at all. Below `lg`, health labels truncate to «برنامه‌ریز…» and «۱ نیاز به …», which is noise rather than information.                                                                                                                                                                        | RSP       |
| C4  | **The cells run together in heavy boxes:** each has a full rounded border, a 4 px start border and a tint, with 4 px gaps (`border-spacing-1`). The grid has five visual weights of border. Outside-month days are well subdued but float as plain numbers without cell outlines, so the first and last weeks look ragged.                                                                                                                          | VIS       |
| C5  | **The finding count is detached from what it counts:** «۲ نیاز به بررسی» places a bare number before the label. There is no hint of which shift is affected (a night-rest finding is always about the day after the night, and the offending shift is known in the data).                                                                                                                                                                           | IH        |
| C6  | **Today and selected states are weak.** Today is a filled circle around the day number, so it is invisible when today is outside the viewed month (expected), but it is the only emphasis. There is no "selected" state: after closing the day dialog, focus returns but nothing marks the last-viewed day for a pointer user.                                                                                                                      | VIS, INT  |
| C7  | **The legend misleads and runs long.** The holiday legend is always shown although `NO_HOLIDAY_DATA` means no holiday can ever appear (D41), and it does not say that holiday data is not connected. Three explanatory sentences are set in 12 px under the grid. The VALID caveat is correct but hidden there.                                                                                                                                     | IH, CON   |
| C8  | **Weekends are not distinguished.** Friday is a normal cell. D41 correctly forbids treating Friday as a holiday, so no change in meaning is proposed, but a light "weekend column" treatment in the header is common in Iranian calendars and helps orientation.                                                                                                                                                                                    | VIS       |
| C9  | **There is no arrow-key grid navigation.** Thirty links in reading order mean 30 Tab stops before the preferences card. That is acceptable for 7a, but it becomes a real cost once the grid is the editing surface (7b).                                                                                                                                                                                                                            | A11Y, INT |

### Day detail

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                       | Cat.      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| D1  | **A valid day contradicts itself:** the Findings box is always rendered with the heading «نیاز به بررسی» and the attention icon, then says «(بدون مورد)». A VALID or UNPLANNED day therefore opens with "needs attention" at full weight.                                                                                                                                                                                                     | IH, VIS   |
| D2  | **Findings are not linked to people or shifts.** A night-rest finding names «پریسا نوری», but in the E list below, Parisa's row has no conflict marker. On a 20-person day the user has to re-find the name by reading. Stable data already exists: `ReviewFinding.nurseIds` and the violation's `shift`.                                                                                                                                     | IH, INT   |
| D3  | **Finding messages are one long sentence each.** Who, when, what and why are merged into roughly 40 words; with 2–3 findings on a phone that is more than a full screen. The structure (nurse · night date → this shift · rule) is not scannable.                                                                                                                                                                                             | IH        |
| D4  | **Metadata sits at the same weight as the data.** Each shift section shows hours, a coverage sentence, «حداقل و حداکثر نفرات تعریف نشده است» (the same text four times), then names. The staffing-not-configured status is a department-level fact repeated per shift.                                                                                                                                                                        | IH        |
| D5  | **Nurse rows are tall and wasteful:** 45 px each, with a 32 px avatar that only repeats the initials of the name next to it. An 8-person E shift is about 360 px. Role (سرپرستار) is pushed to the far end of the row, visually disconnected. The preference chip («ترجیح: شب») is shown only when a preference exists, which is correct, but there is no marker when a preference _differs_ from the assignment, which is the useful signal. | VIS, IH   |
| D6  | **The dialog header scrolls away.** On phones the full-screen `<dialog>` scrolls as one block, so the close button and date disappear after the first swipe. There is no sticky header and no in-dialog day navigation (previous / next day), so reviewing consecutive days means close, tap, open.                                                                                                                                           | RSP, INT  |
| D7  | **The close button's focus ring is heavy on open.** `showModal()` focuses the close button, and its 3 px ring (a gray box) is the most visible element of the dialog on first paint.                                                                                                                                                                                                                                                          | VIS, A11Y |
| D8  | **Unassigned staff are hidden in `<details>`.** That is correct progressive disclosure, but the count («بدون شیفت در این روز (۸ نفر)») sits at the very bottom, below four shift boxes, so on desktop it is below the fold.                                                                                                                                                                                                                   | IH        |
| D9  | **Opening a day has no pending state.** Opening is a server navigation (`?day=`); on a slow connection nothing happens between the click and the dialog. There is no `loading.tsx` or `error.tsx` for the schedule route, so a server failure shows the generic Next error page.                                                                                                                                                              | INT       |

### Roster, preferences and states

| #   | Finding                                                                                                                                                                                                                                                                                        | Cat. |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| R1  | **The roster card reports the Head Nurse as a separate count** («پرستار ۲۷ / سرپرستار ۱»), which subtly frames them as not part of the working staff. The list is behind a disclosure and shows only name and role: no per-nurse context such as preference completion or assigned-day counts. | IH   |
| R2  | **The preference badge uses literal palette colors** (`emerald-600`) where every other status uses semantic tokens. The ESLint and test conventions guard `health-*` but not this.                                                                                                             | CON  |
| R3  | **The preferences and roster cards give equal weight to things of unequal importance** (the facts `dl`, the long explanatory paragraphs, and the action).                                                                                                                                      | IH   |
| S1  | **An empty month is only a message and a button.** It is correct (D39) and uncluttered, but the create dialog it opens is still titled with the generic flow. Keeping it is fine; the empty state could also say what creation does (roster snapshot), as `EmptySchedules` already does.       | IH   |
| S2  | **Some audited states have no UI:** loading (no `loading.tsx`), server failure (no route `error.tsx`), and "schedule exists but no assignments" (it renders a fully "unplanned" grid with no guidance). "Stale edit" does not exist until 7b.                                                  | INT  |

### Cross-cutting

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                     | Cat. |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| X1  | **There is no shared status-badge or shift-chip primitive.** Pill markup (`inline-flex … rounded-full border px-2.5 py-1 text-xs`) is duplicated in `ScheduleStatusBadge`, `PreferenceStateBadge`, `DayBadges`, `HealthTotals` and the legend; shift chips are re-styled in the cell, `ShiftSection` and `ShiftLegend` with different sizes and paddings.                                                                                   | CON  |
| X2  | **RTL is correct.** Chevrons point the right way (previous = start = right), mixed `dir="ltr"` shift codes render correctly, and the Saturday-first order is correct. One detail: in the coverage chip, `M ۸` mixes a Latin code with Persian digits inside an LTR run and is read by screen readers as "M eight" only via the cell's `aria-label`, which is fine. No RTL bugs were found; the risk lies in future popovers and menus (7b). | RTL  |
| X3  | **Mobile is the desktop grid, shrunk.** The phone calendar shows seven 50 px cells with only a health icon: no counts and no finding numbers except on attention days. It is useful as a navigator, but "which days need me" requires scanning 30 tiny icons. The whole page is about 4.5 screens tall on a Pixel 7, with the actionable card last.                                                                                         | RSP  |
| X4  | **Dark-mode tokens exist but nothing sets `.dark`.** No change is proposed, but any new tokens must keep both themes.                                                                                                                                                                                                                                                                                                                       | CON  |
| X5  | **Performance is healthy today.** The month is server-rendered with no client JavaScript per cell; one day open costs 5 queries regardless of department size (D47). Risks start in 7b: a client-side editing grid must not re-render all 31 cells per change or ship the full 60×31 assignment matrix to every cell.                                                                                                                       | PERF |
| X6  | **The E2E suite locates the calendar by the region name «مرور ماهانه»** and by visible text. Redesigning the header will require updating locators; the assertions themselves (6 rows, 30 links, accessible names, overflow) must stay.                                                                                                                                                                                                     | —    |

## 3. Proposed Phase 7c plan

Each task is tagged **[7a]** (it refines what exists and can be done on the current branch) or
**[7b]** (it depends on the editing UI, so it waits for Phase 7b).

### 3.1 Page hierarchy and header [7a]

One **schedule header** replaces the page header, the orphan button, the summary card and the
calendar's own heading:

```
[‹ مهر]   آبان ۱۴۰۵   [آذر ›]      ۱ تا ۳۰ آبان · ۳۰ روز         وضعیت: ◌ پیش‌نویس  · فقط مشاهده
بخش داخلی ۲ (قلب) — برنامه بخش     ترجیحات: باز نشده             [باز کردن ثبت ترجیحات]   [⋯ ماه دیگر]
```

- **Row 1** holds the month switcher (the only month navigation, D39) with the month as the
  `h1`-level focal point, then the date range, then the lifecycle status and editability («فقط
  مشاهده» in 7a).
- **Row 2** holds department context, preference-window state (a compact badge), the single
  **next action** for the current status (open or close preferences), and a quiet secondary
  control, «ماه دیگر…», that opens the existing create dialog (months already scheduled stay
  disabled with «دارای برنامه», D18).
- The empty month keeps the same header with no status. The body message stays
  «برای این ماه هنوز برنامه‌ای ایجاد نشده است.», and the primary create button appears only when
  `canCreate` is true.
- The lifecycle badge gets one icon per status (DRAFT dashed circle, PLANNING pencil, FINALIZED
  lock, SUBMITTED send, RETURNED undo, APPROVED check-badge, REVISING history). Only APPROVED uses
  a check icon.

### 3.2 Calendar [7a]

- **Quiet by default, loud on exceptions:**
  - VALID has no tint and no colored border, only the small check icon.
  - NEEDS_ATTENTION has an attention tint, a 2 px attention outline and a count badge with its
    icon.
  - UNPLANNED has a dashed outline and a muted day number.
  - Shape, icon and text carry every state without color.
- **Counts become the content:** a compact `M ۸ · E ۹ · N ۴` row in `text-xs` or `tabular-nums`,
  visible from `md` up, replacing the per-cell health label. The health label moves into the
  accessible name and the tooltip or `title`. At `md`–`lg`, codes and numbers only; at `xl+`,
  optionally the ME count.
- **Cell outlines:** a single hairline border grid (shared borders, no gaps), with outside-month
  cells kept as muted outlined cells so the week rows stay even. Holiday: a day number in the
  holiday tone plus a «تعطیل» tag, unchanged in meaning.
- **Weekday header:** Friday header in muted holiday tone (header only; no meaning change, D41).
- **Selected state:** the day in `?day=` gets a 2 px ring and `aria-current` stays reserved for
  today. The last-opened day keeps a subtle ring after closing. That day is already in the URL
  until close, so this needs a transient client state, `data-last-viewed`.
- **Legend:** one line of shift chips and health icons; the VALID caveat moves to the health
  summary's tooltip or description; the holiday legend shows only when holiday data is connected.
  Otherwise one line says that official holidays are not connected yet (true under D41).
- **Keyboard [7b-prep]:** arrow-key roving focus across the grid (Home/End for week start/end,
  PageUp/PageDown for month). This is only worth doing together with 7b's editing interactions;
  it is listed here so both phases agree on one model.

### 3.3 Shift presentation [7a]

- One `ShiftChip` primitive (`size: "xs" | "sm" | "md"`, `variant: "solid" | "outline"`,
  optional `count`, optional `label`) replaces the three ad-hoc versions. Code text is always
  present and `dir="ltr"`; the Persian name is optional.
- Colors stay in `globals.css` `shift-*` tokens and `features/shifts/catalog.ts` (D42); no shift
  metadata is copied into components.
- Selected and conflict variants (`ring` and a small attention dot plus text) are defined now but
  used by 7b.

### 3.4 Health system and VALID wording [7a]

Visual changes as in §3.2. **Wording:** «بدون ایراد» literally reads as "flawless / without
defect", which leans towards "correct" in a way D40 tries to avoid. There are two options:

1. Keep «بدون ایراد». This needs no decision change, but the visual quieting in §3.2 already
   removes most of the "all good" impression.
2. **Recommended:** «مغایرتی یافت نشد» in the detail and legend, and «بدون مغایرت» in compact
   places. "No discrepancy found" describes the result of a check, not a quality of the day, and
   pairs with the findings vocabulary. It needs a new decision (proposed **D48**) amending D40's
   wording, plus an update of the unit test that pins the label and of the E2E accessible names.

This is a wording change for the product owner to approve; the plan works with either option.

### 3.5 Day detail [7a for read-only; 7b for editing]

- **Header [7a]:** date, health badge, holiday badge and «فقط مشاهده» stay; the header becomes
  sticky inside the dialog. Previous and next day buttons (in RTL order) go in the header; they
  are `?day=` links, so no new data path is needed.
- **Findings [7a]:** rendered only when there are findings. Each is structured as follows: a
  title (rule), then a line with **who** (the name), **when** (the night date → this day) and
  **which shift** (a chip), then the severity. The full Persian sentence stays available,
  collapsed or as secondary text. A VALID day shows one quiet line with the D40 description; an
  UNPLANNED day shows «برای این روز هنوز شیفتی ثبت نشده است.»
- **Conflict markers [7a]:** a nurse row whose `userId` appears in a finding gets an attention
  icon and a visually hidden «دارای مورد نیاز به بررسی». The finding's name links to that row
  with an in-dialog anchor.
- **Shifts [7a]:** a compact section header with chip, name, hours and count. The coverage line
  is kept for M, E and N (ME explains that it counts toward both). The repeated «حداقل و حداکثر
  نفرات تعریف نشده است» collapses to one note for the day (D44 is unchanged: the status per
  period is still available in the accessible text or tooltip).
- **Nurse rows [7a]:** 32 px rows, a smaller 24 px monogram (or none on desktop), the role as
  inline secondary text right after the name (the Head Nurse is listed exactly like any other
  rostered nurse), and the preference chip. It is marked «≠ ترجیح» when the preference differs from the
  assignment, and never worded as an assignment (D35).
- **Layout [7a]:** desktop keeps the large modal with M/E and N/ME in two columns. The
  unassigned summary moves up next to the findings as a count with a disclosure. Phones keep full
  screen (D45) with a sticky header and sections stacked in order: findings, M, E, N, ME,
  unassigned.
- **Editing [7b]:** a side panel versus a modal, per-row shift pickers, an action bar,
  «what can I change» affordances on findings, the stale-revision conflict message, and
  optimistic-update visuals. All of these wait for 7b's interaction model.

### 3.6 Roster and preferences [7a]

- Replace the two bottom cards with one **«پرسنل و ترجیحات»** section. It holds the roster
  as a compact table (name, role as secondary metadata, and a preference-days count once 7b or a
  later phase exposes it) and the preference window facts. The Head Nurse is listed in
  alphabetical order with everyone else; there are no separate headcount rows, only
  «۲۸ نفر (شامل سرپرستار)».
- Use a shared `StatusBadge` with semantic tokens for the preference state (this fixes R2).

### 3.7 States [7a unless noted]

| State                           | Treatment                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Month without schedule          | Unchanged text (D39); the header stays; create only with `canCreate`.                                                                                                                |
| Schedule with no assignments    | The calendar renders; a one-line note above it: «هنوز شیفتی ثبت نشده است؛ همه روزها برنامه‌ریزی‌نشده‌اند.» (7b adds the "start planning" action).                                    |
| Roster empty                    | Cannot occur by D30 (creation rejects an empty period roster); keep a defensive message in the roster section.                                                                       |
| Loading                         | `loading.tsx` for the schedule route: a header skeleton plus a grid skeleton with fixed row heights (no layout shift). Day open: pending ring on the clicked cell (`useLinkStatus`). |
| Server failure                  | Route `error.tsx`: «بارگذاری برنامه ممکن نشد» with retry; no stack or code.                                                                                                          |
| Permission failure              | Unchanged: 404 (D26, D46).                                                                                                                                                           |
| Preference window open / closed | A header badge and one line in the roster and preferences section.                                                                                                                   |
| No diagnostics / diagnostics    | Per §3.2 and §3.5.                                                                                                                                                                   |
| Stale or conflicting edit       | **[7b]**: its wording belongs to the edit commands' `CONFLICT` mapping.                                                                                                              |

### 3.8 Responsive and mobile [7a]

- **Desktop (≥1024 px):** dense grid with counts, a header on two rows, and the day modal.
- **Tablet (768–1023 px):** grid with codes and counts (no labels); the day modal takes 90% of
  the viewport width.
- **Phone (<768 px):**
  - The grid stays as a compact **navigator**: day number, a health mark, and an attention count
    badge.
  - Below it, an **«روزهای نیازمند بررسی»** list gives one row per attention day, with date,
    count and first finding title, linking to the day. It uses the same aggregates, so there are
    no new queries (D47). This makes "what needs me" answerable without scanning icons.
  - The header collapses to the month switcher, a status badge and an overflow menu for
    secondary actions.
  - The day detail stays full screen with a sticky header and previous/next day.

### 3.9 Shared primitives and tokens

| Primitive                                         | Location                                    | Replaces                                                                                                      |
| ------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `StatusBadge` (`tone`, `icon`, `size`)            | `src/components/ui/status-badge.tsx`        | 5 duplicated pill implementations                                                                             |
| `ShiftChip`                                       | `src/features/shifts/shift-chip.tsx`        | cell chips, `ShiftSection` heading chip, `ShiftLegend` item                                                   |
| `HealthIndicator` (icon + optional label + count) | `src/features/schedule-review/`             | `HealthIcon` usages, including the cell label logic                                                           |
| `SectionHeader` (title, meta, actions)            | `src/components/ui/section-header.tsx`      | `Card` title rows, day-detail section headings                                                                |
| `MetadataRow` (`dl` pair)                         | `src/components/ui/metadata.tsx`            | `Facts`                                                                                                       |
| `ScheduleHeader`                                  | `src/features/schedule/schedule-header.tsx` | `PageHeader` usage on this page, `MonthHeader`, the summary card                                              |
| Tokens                                            | `globals.css`                               | Add `--status-open` (preference open) and keep all `health-*` and `shift-*` tokens; no new colors for shifts. |

No new dependencies. `Dialog` stays on native `<dialog>`; the sticky header is a CSS change in
`DayDetailDialog`. Motion is limited to a 120 ms opacity/scale transition on dialog open, under
`motion-safe:`.

### 3.10 Files expected to change [7a scope]

- `src/app/(app)/departments/[code]/schedule/page.tsx` for header composition, plus new
  `loading.tsx` and `error.tsx`.
- `src/features/schedule-review/month-calendar.tsx`, `presentation.ts`, `health-icon.tsx`
  (becoming `HealthIndicator`), `day-detail.tsx`, `day-detail-dialog.tsx` and `empty-month.tsx`,
  plus a new `attention-list.tsx` (mobile).
- `src/features/schedule/schedule-overview.tsx` (split into `schedule-header.tsx` and
  `roster-preferences.tsx`), `labels.ts` (status icons), `create-schedule-dialog.tsx` (trigger
  variant only).
- `src/features/shifts/` for the new `shift-chip.tsx`; `src/features/shell/shift-legend.tsx`
  moves to `ShiftChip`.
- `src/components/ui/` for `status-badge.tsx`, `section-header.tsx` and `metadata.tsx`.
- `src/app/globals.css` (one token).
- `docs/decisions.md`, which gets the new decisions (§5) once they are approved.
- Not touched: `src/domain/**`, `src/application/**` (no new fields are needed: findings already
  carry `nurseIds` and the violation's shift), `src/infrastructure/**`, and migrations.

### 3.11 Accessibility

- The status meaning stays in text in every place: a cell `aria-label` (existing), a badge label,
  and a visually hidden conflict text on nurse rows.
- The calendar stays a `<table>` with `<th scope="col" abbr>`. If 7b adds a roving focus, it
  becomes an ARIA `grid` with the same accessible names.
- The dialog keeps the native `<dialog>` semantics. The sticky header keeps the close button
  reachable, and focus return to the cell is preserved (existing test).
- Touch targets: 44 px for buttons and nav, and cells ≥ 44×56 on phones. Desktop density comes
  from smaller text, not smaller targets for primary controls.
- Contrast: verify the new attention tint and outline against WCAG 1.4.11 (3:1 for UI components)
  in light and dark.
- `prefers-reduced-motion`: every transition is under `motion-safe:`.

### 3.12 Tests

Keep every existing assertion; update only locators whose markup moves (the region name
«مرور ماهانه» becomes the schedule header region; the assertions on 6 rows, 30 links, the
accessible names, no ISO dates, no rule codes and no horizontal overflow stay).

New unit tests:

- `StatusBadge` and schedule status: every `ScheduleStatus` has a distinct icon, and only
  APPROVED uses the check icon.
- Presentation: the wording for VALID and UNPLANNED on day detail without findings never
  contains «نیاز به بررسی».
- `ShiftChip`: tokens come from the catalog; the code text is always rendered.
- Finding structure: who, when and shift are derived from the violation for every `RuleCode`
  (exhaustive, like `findingMessage`).

New E2E tests in `schedule-review.spec.ts`, run on all three browser projects:

- A VALID cell has no attention styling; a NEEDS_ATTENTION cell exposes its count in the
  accessible name (exists) and in a visible badge.
- The header shows month, range, status and the single next action; the create control is
  secondary and opens with existing months disabled.
- In the day detail, a nurse named in a finding is marked in their shift list (accessible text).
- In the day detail, previous and next day move `?day=` and keep the URL form (month or
  schedule).
- Phones: the attention list lists exactly the attention days and links to them; the dialog
  header stays visible after scrolling.
- An empty assignment month shows the no-assignment note; an empty month is unchanged.
- Existing: keyboard open/close with focus return; Jalali year crossing; 404 for nurse and
  supervisor.

Commands: `pnpm check`, `pnpm test:integration`, then
`pnpm build && pnpm test:e2e --project=desktop-chromium --project=mobile-android --project=mobile-ios`.
Manual checks: screenshots at the five viewports in §1 with 28 nurses × 30 days, in light and
dark tokens, and with 200% browser zoom.

### 3.13 Risks and regressions

- **Rework after 7b:** the day detail is the part 7b changes most. Doing its layout in 7c first
  risks redoing it. Mitigation: 7c limits day-detail work to read-only structure and primitives
  that 7b reuses.
- **Locator churn in E2E tests:** header restructuring breaks region-name locators. They should
  be updated in the same commit, never deleted.
- **Wording change (§3.4)** touches a unit test that exists to guard D40. It must change only
  through an approved decision.
- **Density against touch:** a smaller desktop cell must not reduce phone targets. Breakpoint
  tests (`expectNoHorizontalOverflow`, the full-screen dialog assertion) cover this.
- **Performance:** everything proposed stays server-rendered except the transient
  "last-viewed" ring and `useLinkStatus` pending state, which are client islands per cell or per
  link, not a client calendar.

### 3.14 Explicitly unchanged

The following stay exactly as they are:

- `DayHealth` semantics and precedence (D40), with VALID not implying staffing.
- The holiday dimension (D41) and the rule that Friday is not a holiday.
- Shift codes, hours and coverage (ME counts toward M and E; D42).
- Night rest (D7, D20) and the diagnostics' stable codes (D43).
- Staffing NOT_CONFIGURED (D44).
- The Saturday-first, 5- or 6-week grid; subdued, inert spillover days; chronological month
  navigation, never skipping (D39).
- One schedule per department and month, with existing months disabled in the create dialog
  (D18, D30).
- Roster membership separate from assignments (D21); the Head Nurse as a rostered, schedulable
  member.
- Authorization: `department.manage` page guard, `schedule.viewDepartment` in the use case, and
  404 on denial (D26, D27, D46).
- The aggregate-first queries (D47).
- No Phase 8 workflow and no new statuses or roles.

## 4. Tasks that depend on Phase 7b

1. Editing affordances in the day surface: per-nurse shift picker, clear, and bulk actions; the
   choice between a desktop side panel and a modal.
2. The selected-shift and selected-nurse states in the calendar and day detail, used while
   assigning.
3. Keyboard editing model (roving grid focus, shortcuts for M/E/N/ME/clear) and its ARIA `grid`
   semantics.
4. The stale-revision (`CONFLICT`) message and recovery, and optimistic-update visuals.
5. "What can I change" actions on findings (for example "clear M on 14 Aban for Parisa").
6. A roster × day matrix view, if 7b introduces one: its density, sticky headers and render
   budget for 60 × 31.
7. E2E coverage for the editing flows above on all three browser projects.
8. Performance verification of client-side updates (no whole-calendar re-render per change).

## 5. Proposed decisions (to add to `docs/decisions.md` once approved)

- **D48 · VALID wording**: «مغایرتی یافت نشد» / «بدون مغایرت», if option 2 of §3.4 is
  chosen.
- **D49 · Schedule page hierarchy**: one schedule header (month switcher, lifecycle,
  editability, single next action; create-another-month as a secondary control); roster and
  preferences as one section below the calendar.
- **D50 · Calendar emphasis**: exceptions are loud and VALID is quiet. Cells lead with coverage
  counts and health lives in the icon, shape and accessible name. The holiday legend is shown
  only when holiday data is connected.
- **D51 · Mobile schedule review**: the grid is a navigator, plus an attention-day list; the day
  detail is full screen with a sticky header and previous/next day.

## 6. Reference mockup (when supplied)

**Carry into the product:**

- stronger hierarchy and a single header;
- calmer colors;
- cleaner cells with hairline borders;
- a clear selected state;
- consistent chips;
- typography with tabular numerals;
- cohesive page chrome.

**Reject if the mockup has it:**

- a fixed 35-cell grid;
- clickable spillover days;
- per-cell nurse names in the month (D47: the month carries no names);
- "fully staffed" or green-for-OK language;
- color-only status;
- physical left/right layout;
- decorative dashboard cards or KPI tiles;
- a combined month-picker dropdown that skips empty months;
- any Phase 8 submit or approve controls.

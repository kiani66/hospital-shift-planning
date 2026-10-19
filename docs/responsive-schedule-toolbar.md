# Responsive monthly schedule toolbar

Branch: `fix/responsive-schedule-toolbar`.

## Root cause

The header combined two nested, wrapping flex containers. Submission controls
were placed beside the heading, while other workflow controls shared the
secondary action container. State-dependent actions and nested export controls
changed the available space, so individual buttons wrapped independently.
The header also clipped overflow, which prevented an accessible action panel
from extending beyond its bounds.

## UI changes

- Keep the department, Jalali month, calendar icon and month links together.
- Place lifecycle actions first, followed by the existing preference action,
  in a separate workflow group. Keep all original controls and conditions.
- Use container queries, so the sidebar's available content width determines
  the layout: stacked groups on phones, grouped rows on tablets, one compact
  row when space allows, and inline secondary actions on spacious screens.
- Show secondary actions through «عملیات بیشتر» at constrained widths. It is
  a disclosure with ordinary buttons/links: Tab enters the controls and Escape
  closes it and restores trigger focus. Confirmation dialogs retain their own
  Escape handling and focus return. On phones the panel expands in flow;
  larger layouts anchor it below the trigger.
- Keep controls at 44px, preserve single-line labels, icon sizing, Persian text,
  RTL directions, disabled explanations, original dialog state and handlers.
- Preserve the Supervisor review header's original layout.

No scheduling rules, authorization, API, database schema, production settings,
or workflow transitions were changed. No new actions or UI dependencies were added.
The existing calendar icon is decorative; no new date-selector action was introduced.

## Modified files

- `src/app/(app)/departments/[code]/schedule/page.tsx`
- `src/features/schedule/schedule-header.tsx`
- `src/features/schedule/monthly-toolbar.tsx`
- `src/features/schedule/monthly-toolbar.module.css`
- `src/features/schedule/monthly-toolbar.test.ts`
- `tests/e2e/schedule-toolbar.spec.ts`
- `tests/e2e/support/schedule-toolbar.ts`
- `tests/e2e/schedule.spec.ts`
- `tests/e2e/schedule-copy.spec.ts`
- `tests/e2e/excel-export.spec.ts`
- `tests/e2e/monthly-reset.spec.ts`
- This report and the three screenshots linked below.

## Verification

- `corepack pnpm check`: passed lint, route generation/type checking, formatting,
  and all 2,488 unit/component tests across 117 files.
- `corepack pnpm build`: passed the production build and TypeScript checks.
- Playwright: **50 passed** across `desktop-chromium` and `mobile-android`, using
  the installed `/usr/bin/chromium` and the local production server. Suites:
  `schedule-toolbar`, `schedule`, `schedule-approval`, `schedule-copy`,
  `excel-export`, and `schedule-import`.
- The toolbar matrix covers 96 state/width/browser configurations, with the
  secondary actions both exposed and collapsed where applicable.
- `git diff --check`: passed.

Reproduce the browser run after building and starting the local application:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
corepack pnpm test:e2e \
  tests/e2e/schedule-toolbar.spec.ts tests/e2e/schedule.spec.ts \
  tests/e2e/schedule-approval.spec.ts tests/e2e/schedule-copy.spec.ts \
  tests/e2e/excel-export.spec.ts tests/e2e/schedule-import.spec.ts \
  --project=desktop-chromium --project=mobile-android --workers=2
```

The toolbar matrix uses real schedules and action components in Draft, Planning,
Finalized, Submitted, Approved and Revising. Widths: 320, 375, 768, 1024, 1280,
1440, plus 1920 and 2560 to cover inline secondary actions. It checks RTL,
horizontal overflow, control overlap, clipped labels, 44px targets, equivalent
height after closing the disclosure, disabled explanations, keyboard operation,
and confirmation-dialog focus return. Revising includes the longest existing
export label with a real saved template. Existing workflow suites cover
Head Nurse, nurse and Supervisor permissions and original action behavior.

## Screenshots

- [Desktop, 1440px](screenshots/responsive-schedule-toolbar/desktop-1440.png)
- [Tablet, 768px](screenshots/responsive-schedule-toolbar/tablet-768.png)
- [Mobile, 375px](screenshots/responsive-schedule-toolbar/mobile-375.png)

## Limitations

- Automated browser validation uses Chromium desktop and Android emulation;
  Safari/WebKit and manual screen-reader testing have not been run.
- The environment runs Node 24; the project declares Node 22. pnpm 10.33.0
  matches the project's pinned package manager.
- The destructive monthly-reset browser suite is excluded by the normal
  Playwright configuration. Its trigger helper was updated; no reset was executed.

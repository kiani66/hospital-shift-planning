import { CalendarPlus } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";

/**
 * A calendar month that has no schedule. It stays the selected month (the
 * header above still navigates by calendar month, D39); `action` is the
 * create-month control, preselected to this month, given only when the Head
 * Nurse may create. Without it the state still says why nothing is shown.
 */
export function EmptyMonth({
  label,
  action,
}: {
  label: string;
  action: ReactNode | null;
}) {
  return (
    <section aria-label={`برنامه ${label}`}>
      <EmptyState
        icon={<CalendarPlus aria-hidden="true" />}
        headingLevel={2}
        title="برای این ماه هنوز برنامه‌ای ایجاد نشده است."
        description={
          action
            ? `با ایجاد برنامه ${label}، فهرست پرسنل همین ماه ثبت می‌شود و می‌توانید ترجیحات را جمع کنید و شیفت‌ها را بچینید. هر بخش برای هر ماه فقط یک برنامه دارد.`
            : "ایجاد برنامه ماهانه فقط برای سرپرستار بخش ممکن است."
        }
        action={action}
      />
    </section>
  );
}

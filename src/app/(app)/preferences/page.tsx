import type { Metadata } from "next";

import { getMyPreferencesPage } from "@/application/preferences/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { PreferencesView } from "@/features/preferences/preferences-view";
import { PageHeader } from "@/features/shell/page-header";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "ترجیحات" };

/**
 * The signed-in nurse's own preferences (Head Nurses included when rostered).
 * `?schedule=<id>` (from a PREFERENCES_OPENED notification) only selects a
 * schedule; the query authorizes it and never trusts the link.
 */
export default async function PreferencesPage({
  searchParams,
}: PageProps<"/preferences">) {
  const ctx = await requireRequestContext();
  const params = await searchParams;
  const scheduleId =
    typeof params.schedule === "string" ? params.schedule : undefined;
  const today = todayIn(APP_TIMEZONE);
  const page = await getMyPreferencesPage(ctx, { scheduleId, today });

  return (
    <>
      <PageHeader
        title="ترجیحات"
        description="ترجیح شیفت خود را برای روزهای ماه ثبت کنید. ترجیح، درخواست شماست و شیفت قطعی نیست."
      />
      <PreferencesView page={page} today={today} />
    </>
  );
}

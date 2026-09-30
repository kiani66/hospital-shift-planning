import type { Metadata } from "next";

import {
  listNotifications,
  type NotificationFilter,
} from "@/application/notifications/queries";
import { requireRequestContext } from "@/features/auth/guards";
import {
  NotificationList,
  NotificationToolbar,
} from "@/features/notifications/notification-list";
import { PageHeader } from "@/features/shell/page-header";
import { loadShellContext } from "@/features/shell/shell-context";

export const metadata: Metadata = { title: "اعلان‌ها" };

/**
 * The signed-in user's own notifications. Every signed-in user may open it;
 * the query is scoped to the trusted actor, so there is nothing else to see.
 */
export default async function NotificationsPage({
  searchParams,
}: PageProps<"/notifications">) {
  const ctx = await requireRequestContext();
  const params = await searchParams;
  const filter: NotificationFilter =
    params.filter === "unread" ? "unread" : "all";
  const requested =
    typeof params.cursor === "string" ? params.cursor : undefined;

  const [page, shell] = await Promise.all([
    listNotifications(ctx, { filter, cursor: requested }),
    loadShellContext(),
  ]);

  return (
    <>
      <PageHeader
        title="اعلان‌ها"
        description="پیام‌های سامانه درباره برنامه‌های شیفت شما."
      />
      <div className="max-w-3xl">
        <NotificationToolbar
          filter={filter}
          unread={shell.unreadNotifications}
        />
        <NotificationList
          filter={filter}
          items={page.items}
          cursor={page.invalidCursor ? null : (requested ?? null)}
          nextCursor={page.nextCursor}
        />
      </div>
    </>
  );
}

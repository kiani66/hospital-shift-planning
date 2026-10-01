import {
  Bell,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Ellipsis,
  History,
  House,
  Inbox,
  MessagesSquare,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import type { NavIcon as NavIconName } from "./navigation";

const ICONS: Record<NavIconName, LucideIcon> = {
  home: House,
  myShifts: CalendarDays,
  preferences: SlidersHorizontal,
  requests: MessagesSquare,
  notifications: Bell,
  departmentSchedule: CalendarRange,
  departmentRequests: Inbox,
  history: History,
  review: ClipboardCheck,
  more: Ellipsis,
};

/** Decorative: every nav item also has a text label. */
export function NavIcon({
  name,
  className,
}: {
  name: NavIconName;
  className?: string;
}) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" className={className} />;
}

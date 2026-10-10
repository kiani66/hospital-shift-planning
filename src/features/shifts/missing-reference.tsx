import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
export function MissingShiftReference() {
  return (
    <EmptyState
      icon={<CalendarRange aria-hidden="true" />}
      title="تعریف شیفت‌ها موجود نیست"
      description="داده پایه شیفت‌ها باید توسط مسئول سامانه دوباره ایجاد شود تا برنامه‌ریزی ادامه یابد. حساب و امکان ورود شما باقی است."
      action={<Link href="/home">بازگشت به نمای کلی</Link>}
    />
  );
}

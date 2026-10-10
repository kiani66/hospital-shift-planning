import Link from "next/link";
import type { FullResetPreview } from "@/application/reset/preview";

export function PersonnelReadiness({ preview }: { preview: FullResetPreview }) {
  return (
    <section aria-label="آمادگی ورود پرسنل" className="space-y-3">
      <h3 className="font-bold">حساب‌های حذف‌شونده و همه حساب‌های حفظ‌شونده</h3>
      <p>
        حساب‌های خارج از دامنه و غیرفعال نیز ممکن است ورود پرسنل واقعی را مسدود
        کنند. شماره پرسنلی تنها کلید تطبیق CSV است؛ غیرفعال کردن حساب، شماره یا
        ایمیل آن را آزاد نمی‌کند.
      </p>
      <p>
        برای هر حساب حفظ‌شونده، شماره و ایمیل را با فایل واقعی مقایسه کنید.
        تطبیق شماره و هویت فعال، همان حساب و رمز فعلی را نگه می‌دارد و فقط عضویت
        اضافه می‌کند یا بدون تغییر می‌ماند؛ این نتیجه به بخش، نقش و تاریخ شروع
        نیز وابسته است. نام متفاوت، ایمیل یا موبایل ناسازگار، حساب غیرفعال و
        عضویت ناسازگار، کل فایل را مسدود می‌کنند. ایمیل حساب دیگر برای شماره
        جدید نیز خطاست.
      </p>
      <p>
        این پیش‌نمایش فایل CSV دریافت نکرده است؛ تعارض قطعی و حساب‌های واقعاً
        قابل استفاده مجدد را در{" "}
        <Link className="underline" href="/admin/personnel/import">
          پیش‌نمایش ورود CSV
        </Link>{" "}
        بررسی کنید. برای رفع تعارض، پرونده مرتبط را باز کنید و فقط اطلاعات
        اشتباه را با هویت تأییدشده اصلاح کنید. اگر فرد آزمایشی دیگری همان شماره
        را دارد، وابستگی‌هایش را در بازنشانی صریح بعدی برطرف کنید یا با تأیید
        مسئول، شماره معتبر و آزاد واقعی همان حساب را ثبت کنید؛ شماره ساختگی
        ندهید و حساب فرد دیگر را با اطلاعات کارمند جدید بازنویسی نکنید. شماره
        پرسنلی قابل خالی کردن نیست؛ ایمیل قابل اصلاح یا حذف صریح در پرونده است.
        سپس فایل را دوباره پیش‌نمایش کنید. رمزها خودکار تغییر نمی‌کنند.
      </p>
      {[
        { label: "حساب‌های حذف‌شونده", users: preview.users },
        {
          label: "همه حساب‌های حفظ‌شونده؛ شامل خارج از دامنه",
          users: preview.preservedUsers,
        },
      ].map((group) => (
        <details key={group.label} open>
          <summary>
            {group.label} ({group.users.length})
          </summary>
          <div className="overflow-auto">
            <table className="w-full text-start">
              <caption className="sr-only">{group.label}</caption>
              <thead>
                <tr>
                  <th>نام / پرونده</th>
                  <th>شماره / ایمیل</th>
                  <th>وضعیت</th>
                  <th>عضویت‌ها</th>
                  <th>علت حفظ و اثر بر ورود</th>
                </tr>
              </thead>
              <tbody>
                {group.users.map((u) => (
                  <tr key={u.id} className="border-t align-top">
                    <td>
                      <Link
                        className="underline"
                        href={`/admin/personnel/${u.id}`}
                      >
                        {u.label}
                      </Link>
                    </td>
                    <td>
                      <p dir="ltr">{u.personnelNumber ?? "—"}</p>
                      <p dir="ltr">{u.email ?? "—"}</p>
                    </td>
                    <td>{u.isActive ? "فعال" : "غیرفعال"}</td>
                    <td>
                      {u.memberships.length
                        ? u.memberships.map((m, i) => (
                            <p key={i}>
                              {m.department} ({m.role}) {m.startedOn} تا{" "}
                              {m.endedOn ?? "بدون پایان"}؛{" "}
                              {m.retained ? "حفظ عضویت" : "حذف عضویت"}
                            </p>
                          ))
                        : "بدون عضویت"}
                    </td>
                    <td>
                      {u.reasons.map((r) => (
                        <p key={r}>{r}</p>
                      ))}
                      <p>
                        {u.importBehavior === "NEW_IDENTITY_AVAILABLE"
                          ? "حساب حذف می‌شود؛ پس از اجرای موفق، شماره و ایمیل آن آزاد می‌شوند"
                          : u.importBehavior === "INACTIVE_BLOCKS_IMPORT"
                            ? "شماره رزرو است؛ حساب غیرفعال، ورود با این شماره را مسدود می‌کند"
                            : u.importBehavior === "EMAIL_RESERVED_ONLY"
                              ? "بدون شماره؛ ایمیل ثبت‌شده همچنان رزرو است"
                              : "شماره و ایمیل ثبت‌شده رزرو هستند؛ هویت برابر ممکن است همین حساب را استفاده کند، هویت متفاوت خطاست"}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  );
}

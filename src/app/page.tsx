const shiftLegend = [
  { code: "M", label: "صبح", className: "bg-shift-m text-shift-m-foreground" },
  { code: "E", label: "عصر", className: "bg-shift-e text-shift-e-foreground" },
  { code: "N", label: "شب", className: "bg-shift-n text-shift-n-foreground" },
  {
    code: "ME",
    label: "صبح و عصر",
    className: "bg-shift-me text-shift-me-foreground",
  },
] as const;

// Phase 0 placeholder: proves the RTL shell, Persian font and design tokens.
// Replaced by the role-aware home in Phase 3.
export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12 sm:py-20">
      <p className="text-sm text-muted-foreground">فاز ۰ — زیرساخت پروژه</p>
      <h1 className="text-2xl leading-relaxed font-bold sm:text-3xl">
        سامانه برنامه‌ریزی شیفت پرستاران
      </h1>
      <p className="leading-loose text-muted-foreground">
        ثبت ترجیحات شیفت توسط پرستاران، تنظیم برنامه ماهانه توسط سرپرستار و
        تأیید نهایی توسط سوپروایزر.
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="انواع شیفت">
        {shiftLegend.map((shift) => (
          <li
            key={shift.code}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${shift.className}`}
          >
            <span className="font-bold" dir="ltr">
              {shift.code}
            </span>
            <span>{shift.label}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

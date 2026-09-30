import type { Metadata } from "next";
import Link from "next/link";

import { IconWell } from "@/components/ui/icon-well";

import { describeRoles } from "@/features/shell/app-shell";
import { NavIcon } from "@/features/shell/nav-icon";
import { buildNavigation } from "@/features/shell/navigation";
import { PageHeader } from "@/features/shell/page-header";
import { loadShellContext } from "@/features/shell/shell-context";

export const metadata: Metadata = { title: "نمای کلی" };

/** Overview for users with more than one kind of access (e.g. Head Nurses). */
export default async function HomePage() {
  const context = await loadShellContext();
  const { sections } = buildNavigation(context);

  return (
    <>
      <PageHeader
        title={`${context.user.displayName}، خوش آمدید`}
        description={describeRoles(context).join("، ")}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections
          .filter((s) => s.title)
          .map((section) => (
            <section
              key={section.id}
              aria-labelledby={`home-${section.id}`}
              className="rounded-xl border bg-card p-4 shadow-xs"
            >
              <h2 id={`home-${section.id}`} className="mb-3 font-semibold">
                {section.title}
              </h2>
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <IconWell>
                        <NavIcon name={item.icon} />
                      </IconWell>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </>
  );
}

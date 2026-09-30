import { cn } from "@/lib/utils";

import { SidebarLink, type NavSurface } from "./nav-link";
import type { NavSection } from "./navigation";

export function NavSections({
  sections,
  surface = "sidebar",
}: {
  sections: readonly NavSection[];
  surface?: NavSurface;
}) {
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-1">
          {section.title && (
            <h2
              id={`nav-${section.id}`}
              className={cn(
                "px-3 pb-1 text-xs font-semibold",
                surface === "sidebar"
                  ? "text-sidebar-muted-foreground"
                  : "text-muted-foreground",
              )}
            >
              {section.title}
            </h2>
          )}
          <ul
            className="flex flex-col gap-1"
            aria-labelledby={section.title ? `nav-${section.id}` : undefined}
          >
            {section.items.map((item) => (
              <li key={item.id}>
                <SidebarLink item={item} surface={surface} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

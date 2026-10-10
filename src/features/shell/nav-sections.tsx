import { useId } from "react";

import { cn } from "@/lib/utils";

import { SidebarLink, type NavSurface } from "./nav-link";
import type { NavSection } from "./navigation";

/**
 * The navigation sections. On a collapsed sidebar rail a section title is
 * screen-reader only (it still names its list) and a hairline separates the
 * sections instead.
 */
export function NavSections({
  sections,
  surface = "sidebar",
}: {
  sections: readonly NavSection[];
  surface?: NavSurface;
}) {
  // The sidebar, the phone drawer and the "more" page can all be in the DOM.
  const idPrefix = useId();
  const rail = surface === "sidebar";
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div
          key={section.id}
          className={cn(
            "flex flex-col gap-1",
            rail &&
              section.title &&
              "sidebar-collapsed:border-t sidebar-collapsed:border-sidebar-border sidebar-collapsed:pt-4",
          )}
        >
          {section.title && (
            <h2
              id={`${idPrefix}-${section.id}`}
              className={cn(
                "px-3 pb-1 text-xs font-semibold",
                surface === "sidebar"
                  ? "text-sidebar-muted-foreground"
                  : "text-muted-foreground",
                rail && "sidebar-collapsed:sr-only",
              )}
            >
              {section.title}
            </h2>
          )}
          <ul
            className="flex flex-col gap-1"
            aria-labelledby={
              section.title ? `${idPrefix}-${section.id}` : undefined
            }
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

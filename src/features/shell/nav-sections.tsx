import { SidebarLink } from "./nav-link";
import type { NavSection } from "./navigation";

export function NavSections({ sections }: { sections: readonly NavSection[] }) {
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-1">
          {section.title && (
            <h2
              id={`nav-${section.id}`}
              className="px-3 pb-1 text-xs font-semibold text-muted-foreground"
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
                <SidebarLink item={item} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

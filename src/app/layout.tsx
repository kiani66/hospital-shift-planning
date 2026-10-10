import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";

import { SIDEBAR_PREPAINT_SCRIPT } from "@/features/shell/sidebar-state";

export const metadata: Metadata = {
  title: {
    default: "برنامه‌ریزی شیفت پرستاران",
    template: "%s | برنامه‌ریزی شیفت پرستاران",
  },
  description: "سامانه برنامه‌ریزی و تأیید شیفت ماهانه پرستاران",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The pre-paint script may add the remembered sidebar state to <html>.
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_PREPAINT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

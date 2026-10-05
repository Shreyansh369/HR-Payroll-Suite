import type { Metadata, Viewport } from "next";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { APP_NAME } from "@/config/env";

export const metadata: Metadata = {
  title: { default: `${APP_NAME} — HR and payroll for small businesses`, template: `%s · ${APP_NAME}` },
  description: "Employee records, leave, attendance, documents and payroll with effective-dated statutory rules, payslips, reports and accounting-ready exports.",
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#f6f5f2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HR & Payroll Suite",
    short_name: "HR & Payroll",
    description: "HR records, leave, attendance and payroll for small businesses.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f6f5f2",
    theme_color: "#1f5c4d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}

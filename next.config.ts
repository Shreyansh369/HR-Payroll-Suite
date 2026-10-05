import type { NextConfig } from "next";

const isDemo = (process.env.DEMO_MODE ?? process.env.NEXT_PUBLIC_DEMO_MODE ?? "true") !== "false";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src https://checkout.stripe.com https://billing.stripe.com",
      "form-action 'self' https://checkout.stripe.com",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join("; "),
  },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_DEMO_MODE: isDemo ? "true" : "false",
    NEXT_PUBLIC_BILLING_ENABLED: !isDemo && process.env.BILLING_ENABLED === "true" ? "true" : "false",
  },
  serverExternalPackages: ["postgres", "@electric-sql/pglite"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

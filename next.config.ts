import type { NextConfig } from "next";

// Baseline security headers for every route. A full CSP is intentionally not set yet —
// it needs Soniox websocket and Supabase Storage origins in connect-src/media-src first.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" }
];

const nextConfig: NextConfig = {
  // headers applies the shared security header baseline to all responses.
  async headers() {
    return [
      {
        headers: securityHeaders,
        source: "/(.*)"
      }
    ];
  },
  reactStrictMode: true
};

export default nextConfig;

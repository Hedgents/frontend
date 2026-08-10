import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-DNS-Prefetch-Control", value: "off" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), payment=()",
        },
      ],
    }, {
      source: "/api/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; sandbox" },
      ],
    }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const mapboxContentSecurityPolicy = [
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.mapbox.com https://events.mapbox.com",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: mapboxContentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default nextConfig;

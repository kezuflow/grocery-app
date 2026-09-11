import type { NextConfig } from "next";
import { resolveSecurityHeaderEnvironment, webStaticSecurityHeaders } from "./lib/security/headers";

const securityHeaders = webStaticSecurityHeaders(resolveSecurityHeaderEnvironment(process.env));

const nextConfig: NextConfig = {
  // Vinext checks multipart POSTs against this limit before matching API routes.
  // Allow our 5 MiB media uploads plus multipart overhead; routes enforce their own limits.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";
import { resolveSecurityHeaderEnvironment, webSecurityHeaders } from "./lib/security/headers";

const securityHeaders = webSecurityHeaders(resolveSecurityHeaderEnvironment(process.env));

const nextConfig: NextConfig = {
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

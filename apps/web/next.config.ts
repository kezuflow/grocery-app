import type { NextConfig } from "next";
import { resolveSecurityHeaderEnvironment, webStaticSecurityHeaders } from "./lib/security/headers";

const securityHeaders = webStaticSecurityHeaders(resolveSecurityHeaderEnvironment(process.env));

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

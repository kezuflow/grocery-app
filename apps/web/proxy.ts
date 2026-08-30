import { type NextRequest, NextResponse } from "next/server";
import {
  createScriptNonce,
  resolveSecurityHeaderEnvironment,
  webSecurityHeaders,
} from "./lib/security/headers";

const environment = resolveSecurityHeaderEnvironment(process.env);

export function proxy(request: NextRequest) {
  const scriptNonce = createScriptNonce();
  const securityHeaders = webSecurityHeaders(environment, scriptNonce);
  const forwardedHeaders = new Headers(request.headers);
  const contentSecurityPolicy = securityHeaders.find(
    (header) => header.key === "Content-Security-Policy",
  );
  if (!contentSecurityPolicy) {
    throw new Error("CONTENT_SECURITY_POLICY_MISSING");
  }
  forwardedHeaders.set(contentSecurityPolicy.key, contentSecurityPolicy.value);

  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  for (const header of securityHeaders) {
    response.headers.set(header.key, header.value);
  }

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

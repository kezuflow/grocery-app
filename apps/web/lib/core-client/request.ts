const CORE_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "x-correlation-id",
  "x-request-id",
] as const;

export function requestHeaders(request: Request): Record<string, string> {
  return coreRequestHeaders(request.headers);
}

/** Filter an incoming Server Component or route header collection for Core. */
export function coreRequestHeaders(incoming: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of CORE_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

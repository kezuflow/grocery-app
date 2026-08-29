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
  const headers: Record<string, string> = {};
  for (const name of CORE_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

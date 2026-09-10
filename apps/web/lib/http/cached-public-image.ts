const lifetimeSeconds = 300;

/** Only use for anonymous, versioned published media responses. */
export async function cachedPublicImage(request: Request, load: () => Promise<Response>) {
  const url = new URL(request.url);
  url.search = "";
  const key = new Request(url, { method: "GET" });
  let cache: Cache | undefined;
  let response: Response | undefined;
  try {
    cache = typeof caches === "undefined" ? undefined : await caches.open("public-images-v1");
    response = await cache?.match(key);
  } catch {
    console.warn("PUBLIC_IMAGE_CACHE_READ_FAILED");
  }
  if (response) {
    const storedAt = Date.parse(response.headers.get("date") ?? "");
    const age = Math.max(0, Math.floor((Date.now() - storedAt) / 1000));
    if (!Number.isFinite(age) || age >= lifetimeSeconds) {
      response = undefined;
    } else {
      response = new Response(response.body, response);
      response.headers.set("age", String(age));
    }
  }
  if (!response) {
    response = await load();
    if (response.status !== 200) return response;
    response.headers.set("cache-control", `public, max-age=${lifetimeSeconds}, must-revalidate`);
    response.headers.set("date", new Date().toUTCString());
    try {
      await cache?.put(key, response.clone());
    } catch {
      // Cache availability must not turn a successful origin read into an outage.
      console.warn("PUBLIC_IMAGE_CACHE_WRITE_FAILED");
    }
  }
  const etag = response.headers.get("etag");
  const condition = request.headers.get("if-none-match");
  if (
    etag &&
    condition
      ?.split(",")
      .some(
        (value) =>
          value.trim() === "*" || value.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""),
      )
  ) {
    return new Response(null, { status: 304, headers: response.headers });
  }
  return response;
}

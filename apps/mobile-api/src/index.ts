import type { AuthResponse, CoreServiceBinding } from "@freshmarkets/contracts";

type CatalogCore = Pick<
  CoreServiceBinding,
  | "getMarketplaceHome"
  | "searchMarketplace"
  | "getCatalogProduct"
  | "searchAddressCandidates"
  | "confirmBrowsingLocation"
  | "auth"
  | "getCart"
  | "setCartItem"
  | "selectCartLocation"
  | "listCustomerOrders"
  | "getCustomerOrderDetail"
  | "getCustomerDeliveryTracking"
  | "getCheckoutBootstrap"
  | "listFulfillmentOptions"
  | "createCheckoutQuote"
  | "abandonCheckoutAttempt"
  | "createPaymentIntent"
  | "getCheckoutPaymentCompletion"
  | "createCustomerAddress"
  | "listSavedProducts"
  | "listPopularWithCart"
  | "setSavedProduct"
  | "getOrderFeedback"
  | "submitOrderFeedback"
>;

/** Wrangler does not infer the RPC method shape from a separate Worker config. */
function catalogCore(binding: Cloudflare.Env["CORE"]): CatalogCore {
  return binding as unknown as CatalogCore;
}

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const localHost = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

function browserOrigin(request: Request): string | null {
  const value = request.headers.get("origin");
  if (!value) return null;
  try {
    const origin = new URL(value);
    const api = new URL(request.url);
    if (
      api.protocol === "http:" &&
      localHost(api.hostname) &&
      origin.protocol === "http:" &&
      localHost(origin.hostname) &&
      origin.port === "8081"
    )
      return origin.origin;
  } catch {
    // Reject malformed browser origins below.
  }
  return "";
}

function authCors(origin: string | null): HeadersInit {
  return origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        vary: "Origin",
      }
    : {};
}

function privateJson(body: unknown, status: number, id: string, origin: string | null): Response {
  return Response.json(body, {
    status,
    headers: { ...authCors(origin), "cache-control": "private, no-store", "x-request-id": id },
  });
}

function privateStatus(result: { ok: boolean; error?: { code: string } }): number {
  if (result.ok) return 200;
  switch (result.error?.code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "VALIDATION_FAILED":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "CART_VERSION_CONFLICT":
    case "STALE_VERSION":
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    default:
      return 422;
  }
}

async function addressLookupLimit(
  request: Request,
  env: Cloudflare.Env,
  id: string,
  origin: string | null,
): Promise<Response | null> {
  try {
    const result = await env.ADDRESS_LOOKUP_RATE.limit({
      key: request.headers.get("cf-connecting-ip") || "unknown",
    });
    return result.success
      ? null
      : privateJson(
          {
            ok: false,
            error: {
              code: "GEOCODER_RATE_LIMITED",
              message: "Too many address lookups. Try again shortly.",
              requestId: id,
            },
          },
          429,
          id,
          origin,
        );
  } catch {
    return privateJson(
      {
        ok: false,
        error: {
          code: "LOCATION_UNAVAILABLE",
          message: "Address lookup is temporarily unavailable.",
          requestId: id,
        },
      },
      503,
      id,
      origin,
    );
  }
}

async function commerceProxy(request: Request, env: Cloudflare.Env, id: string): Promise<Response> {
  const origin = browserOrigin(request);
  if (origin === "") return privateJson({ ok: false, error: { code: "FORBIDDEN" } }, 403, id, null);
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...authCors(origin),
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, x-request-id",
        "access-control-max-age": "600",
      },
    });
  const url = new URL(request.url);
  const cookie = request.headers.get("cookie");
  const headers = { ...(cookie ? { cookie } : {}), "x-request-id": id };
  const core = catalogCore(env.CORE);
  try {
    if (url.pathname === "/v1/cart" && request.method === "GET" && !url.search) {
      const result = await core.getCart({ requestId: id, headers });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/cart" && request.method === "POST" && !url.search) {
      const body = await boundedJson(request);
      if (!body || typeof body !== "object")
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const value = body as Record<string, unknown>;
      if (
        typeof value.cartId !== "string" ||
        !value.cartId ||
        typeof value.skuId !== "string" ||
        !value.skuId ||
        typeof value.quantity !== "number" ||
        !Number.isInteger(value.quantity) ||
        value.quantity < 0 ||
        value.quantity > 999 ||
        typeof value.expectedVersion !== "number" ||
        !Number.isInteger(value.expectedVersion) ||
        value.expectedVersion < 0 ||
        typeof value.idempotencyKey !== "string" ||
        value.idempotencyKey.length < 8
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.setCartItem({
        requestId: id,
        headers,
        cartId: value.cartId,
        skuId: value.skuId,
        quantity: value.quantity,
        expectedVersion: value.expectedVersion,
        idempotencyKey: value.idempotencyKey,
      });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/cart/location" && request.method === "POST" && !url.search) {
      const body = await boundedJson(request);
      const value = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      const point = coordinate(value);
      if (
        !point ||
        !value ||
        typeof value.expectedVersion !== "number" ||
        !Number.isInteger(value.expectedVersion) ||
        value.expectedVersion < 0 ||
        typeof value.idempotencyKey !== "string" ||
        value.idempotencyKey.length < 8
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.selectCartLocation({
        requestId: id,
        headers,
        latitude: point.latitude,
        longitude: point.longitude,
        expectedVersion: value.expectedVersion,
        idempotencyKey: value.idempotencyKey,
      });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/orders" && request.method === "GET") {
      const filter = url.searchParams.get("filter") ?? "all";
      const cursor = url.searchParams.get("cursor") ?? undefined;
      if (
        !["all", "active", "completed"].includes(filter) ||
        (cursor && cursor.length > 2048) ||
        [...url.searchParams.keys()].some((key) => key !== "filter" && key !== "cursor")
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.listCustomerOrders({
        requestId: id,
        headers,
        filter: filter as "all" | "active" | "completed",
        cursor,
        limit: 20,
      });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/favorites" && request.method === "GET" && !url.search) {
      const result = await core.listSavedProducts({ requestId: id, headers });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/cart/popular" && request.method === "GET" && !url.search) {
      const result = await core.listPopularWithCart({ requestId: id, headers });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/favorites" && request.method === "POST" && !url.search) {
      const body = await boundedJson(request);
      const value = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      if (
        !value ||
        typeof value.productId !== "string" ||
        !/^[a-zA-Z0-9-]{1,120}$/.test(value.productId) ||
        typeof value.saved !== "boolean"
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.setSavedProduct({
        requestId: id,
        headers,
        productId: value.productId,
        saved: value.saved,
      });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (
      url.pathname.startsWith("/v1/orders/") &&
      url.pathname.endsWith("/tracking") &&
      request.method === "GET" &&
      !url.search
    ) {
      const orderId = url.pathname.slice("/v1/orders/".length, -"/tracking".length);
      if (!/^[a-zA-Z0-9-]{1,120}$/.test(orderId))
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.getCustomerDeliveryTracking({ requestId: id, headers, orderId });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (
      url.pathname.startsWith("/v1/orders/") &&
      url.pathname.endsWith("/feedback") &&
      !url.search
    ) {
      const orderId = url.pathname.slice("/v1/orders/".length, -"/feedback".length);
      if (!/^[a-zA-Z0-9-]{1,120}$/.test(orderId))
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      if (request.method === "GET") {
        const result = await core.getOrderFeedback({ requestId: id, headers, orderId });
        return privateJson(result, privateStatus(result), id, origin);
      }
      if (request.method === "POST") {
        const body = await boundedJson(request);
        const value = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
        if (
          !value ||
          typeof value.rating !== "number" ||
          !Number.isInteger(value.rating) ||
          value.rating < 1 ||
          value.rating > 5 ||
          (value.comment !== null &&
            (typeof value.comment !== "string" || value.comment.length > 1000))
        )
          return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
        const result = await core.submitOrderFeedback({
          requestId: id,
          headers,
          orderId,
          rating: value.rating as 1 | 2 | 3 | 4 | 5,
          comment: value.comment as string | null,
        });
        return privateJson(result, privateStatus(result), id, origin);
      }
    }
    if (url.pathname.startsWith("/v1/orders/") && request.method === "GET" && !url.search) {
      const orderId = url.pathname.slice("/v1/orders/".length);
      if (!/^[a-zA-Z0-9-]{1,120}$/.test(orderId))
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.getCustomerOrderDetail({ requestId: id, headers, orderId });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/checkout/bootstrap" && request.method === "GET" && !url.search) {
      const result = await core.getCheckoutBootstrap({ requestId: id, headers });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/addresses" && request.method === "POST" && !url.search) {
      const body = await boundedJson(request, 4096);
      const value = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      const point = coordinate(value);
      const components = addressComponents(value?.components);
      if (
        !value ||
        !point ||
        !components ||
        typeof value.label !== "string" ||
        !value.label.trim() ||
        value.label.length > 100 ||
        typeof value.recipient !== "string" ||
        !value.recipient.trim() ||
        value.recipient.length > 200 ||
        typeof value.phone !== "string" ||
        !value.phone.trim() ||
        value.phone.length > 30 ||
        (typeof value.instructions !== "string" && value.instructions !== null) ||
        (typeof value.instructions === "string" && value.instructions.length > 1000) ||
        typeof value.idempotencyKey !== "string" ||
        value.idempotencyKey.length < 8
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.createCustomerAddress({
        requestId: id,
        headers,
        idempotencyKey: value.idempotencyKey,
        label: value.label,
        recipient: value.recipient,
        phone: value.phone,
        latitude: point.latitude,
        longitude: point.longitude,
        components,
        componentsSource: "TEMPORARY_GEOCODER",
        confirmationSource: "GEOCODER",
        instructions: { deliveryInstructions: value.instructions as string | null },
      });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/checkout/options" && request.method === "POST" && !url.search) {
      const body = await boundedJson(request);
      const value = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      if (
        !value ||
        typeof value.addressId !== "string" ||
        !value.addressId ||
        typeof value.addressVersion !== "number" ||
        !Number.isInteger(value.addressVersion) ||
        value.addressVersion < 1 ||
        typeof value.cartId !== "string" ||
        !value.cartId ||
        typeof value.cartVersion !== "number" ||
        !Number.isInteger(value.cartVersion) ||
        value.cartVersion < 1
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.listFulfillmentOptions({
        requestId: id,
        headers,
        addressId: value.addressId,
        addressVersion: value.addressVersion,
        cartId: value.cartId,
        cartVersion: value.cartVersion,
      });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/checkout/quote" && request.method === "POST" && !url.search) {
      const body = await boundedJson(request);
      const value = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      if (
        !value ||
        typeof value.cartId !== "string" ||
        !value.cartId ||
        typeof value.cartVersion !== "number" ||
        !Number.isInteger(value.cartVersion) ||
        value.cartVersion < 1 ||
        typeof value.addressId !== "string" ||
        !value.addressId ||
        typeof value.fulfillmentOptionId !== "string" ||
        !value.fulfillmentOptionId ||
        typeof value.idempotencyKey !== "string" ||
        value.idempotencyKey.length < 8
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.createCheckoutQuote({
        requestId: id,
        headers,
        cartId: value.cartId,
        cartVersion: value.cartVersion,
        addressId: value.addressId,
        fulfillmentOptionId: value.fulfillmentOptionId,
        idempotencyKey: value.idempotencyKey,
      });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/checkout/abandon" && request.method === "POST" && !url.search) {
      const body = await boundedJson(request);
      const value = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      if (
        !value ||
        typeof value.quoteId !== "string" ||
        !value.quoteId ||
        typeof value.expectedVersion !== "number" ||
        !Number.isInteger(value.expectedVersion) ||
        value.expectedVersion < 1 ||
        typeof value.idempotencyKey !== "string" ||
        value.idempotencyKey.length < 8
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.abandonCheckoutAttempt({
        requestId: id,
        headers,
        quoteId: value.quoteId,
        expectedVersion: value.expectedVersion,
        idempotencyKey: value.idempotencyKey,
      });
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/checkout/payment" && request.method === "POST" && !url.search) {
      const body = await boundedJson(request);
      const value = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      const fields = [
        "expectedQuoteVersion",
        "expectedPriceAcceptanceVersion",
        "expectedMerchandiseSubtotalMinor",
        "expectedItemDiscountMinor",
        "expectedOrderDiscountMinor",
        "expectedDeliverySubtotalMinor",
        "expectedDeliveryFeeMinor",
        "expectedDeliveryDiscountMinor",
        "expectedTaxMinor",
        "expectedTotalMinor",
      ] as const;
      if (
        !value ||
        typeof value.checkoutAttemptId !== "string" ||
        !value.checkoutAttemptId ||
        typeof value.expectedCurrency !== "string" ||
        !/^[A-Z]{3}$/.test(value.expectedCurrency) ||
        typeof value.idempotencyKey !== "string" ||
        value.idempotencyKey.length < 8 ||
        fields.some(
          (field) =>
            typeof value[field] !== "number" ||
            !Number.isInteger(value[field]) ||
            (value[field] as number) < 0,
        )
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const returnUrl = (env as Cloudflare.Env & { PAYMENT_RETURN_URL?: string })
        .PAYMENT_RETURN_URL;
      if (!returnUrl || !returnUrl.startsWith("https://"))
        return privateJson({ ok: false, error: { code: "CONFIGURATION_ERROR" } }, 503, id, origin);
      let result;
      try {
        result = await core.createPaymentIntent({
          requestId: id,
          headers,
          checkoutAttemptId: value.checkoutAttemptId,
          expectedQuoteVersion: value.expectedQuoteVersion as number,
          expectedPriceAcceptanceVersion: value.expectedPriceAcceptanceVersion as number,
          expectedCurrency: value.expectedCurrency,
          expectedMerchandiseSubtotalMinor: value.expectedMerchandiseSubtotalMinor as number,
          expectedItemDiscountMinor: value.expectedItemDiscountMinor as number,
          expectedOrderDiscountMinor: value.expectedOrderDiscountMinor as number,
          expectedDeliverySubtotalMinor: value.expectedDeliverySubtotalMinor as number,
          expectedDeliveryFeeMinor: value.expectedDeliveryFeeMinor as number,
          expectedDeliveryDiscountMinor: value.expectedDeliveryDiscountMinor as number,
          expectedTaxMinor: value.expectedTaxMinor as number,
          expectedTotalMinor: value.expectedTotalMinor as number,
          paymentMethod: { kind: "TOKEN", value: "qrph" },
          returnUrl,
          idempotencyKey: value.idempotencyKey,
        });
      } catch {
        return privateJson(
          {
            ok: false,
            error: {
              code: "PAYMENT_OUTCOME_UNRESOLVED",
              message: "Payment setup could not be confirmed. Retry the same payment request.",
              requestId: id,
            },
          },
          503,
          id,
          origin,
        );
      }
      return privateJson(result, privateStatus(result), id, origin);
    }
    if (url.pathname === "/v1/checkout/payment" && request.method === "GET") {
      const paymentIntentId = url.searchParams.get("paymentIntentId");
      if (
        !paymentIntentId ||
        paymentIntentId.length > 200 ||
        [...url.searchParams.keys()].some((key) => key !== "paymentIntentId")
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const result = await core.getCheckoutPaymentCompletion({
        requestId: id,
        headers,
        paymentIntentId,
      });
      return privateJson(result, privateStatus(result), id, origin);
    }
  } catch {
    return privateJson({ ok: false, error: { code: "INTERNAL_ERROR" } }, 503, id, origin);
  }
  return privateJson({ ok: false, error: { code: "NOT_FOUND" } }, 404, id, origin);
}

async function authProxy(request: Request, env: Cloudflare.Env, id: string): Promise<Response> {
  const origin = browserOrigin(request);
  if (origin === "") return publicJson({ error: "ORIGIN_NOT_ALLOWED" }, 403, id);
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...authCors(origin),
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, x-request-id",
        "access-control-max-age": "600",
      },
    });
  if (request.method !== "GET" && request.method !== "POST")
    return new Response(null, { status: 405, headers: authCors(origin) });
  const apiUrl = new URL(request.url);
  const configured = (env as Cloudflare.Env & { AUTH_PUBLIC_ORIGIN?: string }).AUTH_PUBLIC_ORIGIN;
  const authOrigin =
    configured ??
    (apiUrl.protocol === "http:" && localHost(apiUrl.hostname) ? "http://localhost:3000" : null);
  if (!authOrigin) return new Response(null, { status: 503, headers: authCors(origin) });
  let publicOrigin: URL;
  try {
    publicOrigin = new URL(authOrigin);
    if (
      publicOrigin.pathname !== "/" ||
      publicOrigin.search ||
      publicOrigin.hash ||
      (publicOrigin.protocol !== "https:" &&
        !(publicOrigin.protocol === "http:" && localHost(publicOrigin.hostname)))
    )
      throw new Error("INVALID_AUTH_ORIGIN");
  } catch {
    return new Response(null, { status: 503, headers: authCors(origin) });
  }
  const body = request.method === "POST" ? await boundedText(request, 16 * 1024) : undefined;
  if (request.method === "POST" && body === null)
    return new Response(null, { status: 413, headers: authCors(origin) });
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "cookie", "origin", "expo-origin", "x-skip-oauth-proxy"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  headers["x-forwarded-host"] = publicOrigin.host;
  headers["x-forwarded-proto"] = publicOrigin.protocol.slice(0, -1);
  headers["x-forwarded-origin"] = publicOrigin.origin;
  headers["x-request-id"] = id;
  try {
    const result: AuthResponse = await catalogCore(env.CORE).auth({
      method: request.method,
      url: `${publicOrigin.origin}${apiUrl.pathname}${apiUrl.search}`,
      headers,
      body: body ?? undefined,
    });
    if (new TextEncoder().encode(result.body).byteLength > 1024 * 1024)
      return new Response(null, { status: 502, headers: authCors(origin) });
    const responseHeaders = new Headers(authCors(origin));
    for (const [name, value] of result.headers) responseHeaders.append(name, value);
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.set("x-request-id", id);
    return new Response(result.body || null, { status: result.status, headers: responseHeaders });
  } catch {
    return new Response(null, { status: 503, headers: authCors(origin) });
  }
}

function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && requestIdPattern.test(supplied) ? supplied : crypto.randomUUID();
}

function publicJson(body: unknown, status: number, id: string): Response {
  return Response.json(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "x-request-id": id,
    },
  });
}

function invalid(id: string): Response {
  return publicJson({ ok: false, error: { code: "VALIDATION_FAILED" }, requestId: id }, 400, id);
}

function readStatus(result: { ok: boolean; error?: { code: string } }): number {
  if (result.ok) return 200;
  if (result.error?.code === "VALIDATION_FAILED") return 400;
  return 503;
}

async function boundedJson(request: Request, maximumBytes = 2048): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return null;
  const body = await boundedText(request, maximumBytes);
  if (body === null) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

async function boundedText(request: Request, maximumBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function coordinate(value: unknown): { latitude: number; longitude: number } | null {
  if (!value || typeof value !== "object") return null;
  const point = value as Record<string, unknown>;
  return typeof point.latitude === "number" &&
    Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 90 &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.longitude) <= 180
    ? { latitude: point.latitude, longitude: point.longitude }
    : null;
}

function addressComponents(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const nullable = (key: string, limit: number) =>
    input[key] === null ||
    (typeof input[key] === "string" && (input[key] as string).length <= limit);
  if (
    typeof input.addressLine1 !== "string" ||
    !input.addressLine1.trim() ||
    input.addressLine1.length > 500 ||
    typeof input.city !== "string" ||
    !input.city.trim() ||
    input.city.length > 200 ||
    typeof input.countryCode !== "string" ||
    !/^[A-Za-z]{2}$/.test(input.countryCode) ||
    !nullable("addressLine2", 500) ||
    !nullable("barangay", 500) ||
    !nullable("region", 500) ||
    !nullable("postalCode", 32)
  )
    return null;
  return {
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 as string | null,
    barangay: input.barangay as string | null,
    city: input.city,
    region: input.region as string | null,
    postalCode: input.postalCode as string | null,
    countryCode: input.countryCode,
  };
}

function browsingContext(request: Request): string | undefined | null {
  const token = request.headers.get("x-browsing-context");
  if (!token) return undefined;
  return token.length <= 2048 && /^[A-Za-z0-9_.-]+$/.test(token) ? token : null;
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    const id = requestId(request);

    if (url.pathname === "/health" && request.method === "GET") {
      return publicJson({ status: "ok" }, 200, id);
    }
    if (url.pathname.startsWith("/api/auth/")) return authProxy(request, env, id);
    if (
      url.pathname === "/v1/cart" ||
      url.pathname === "/v1/cart/location" ||
      url.pathname === "/v1/cart/popular" ||
      url.pathname === "/v1/favorites" ||
      url.pathname === "/v1/orders" ||
      url.pathname.startsWith("/v1/orders/") ||
      url.pathname.startsWith("/v1/checkout/") ||
      url.pathname === "/v1/addresses"
    )
      return commerceProxy(request, env, id);
    if (url.pathname.startsWith("/v1/catalog/") && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "x-request-id, x-browsing-context",
          "access-control-max-age": "600",
        },
      });
    }
    if (url.pathname.startsWith("/v1/location/") && request.method === "OPTIONS") {
      const origin = browserOrigin(request);
      if (origin === "") return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          ...authCors(origin),
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type, x-request-id",
          "access-control-max-age": "600",
        },
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/location/search") {
      const origin = browserOrigin(request);
      if (origin === "") return new Response(null, { status: 403 });
      const body = await boundedJson(request);
      if (
        !body ||
        typeof body !== "object" ||
        typeof (body as Record<string, unknown>).query !== "string"
      )
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const query = (body as { query: string }).query.trim();
      if (!query || query.length > 200)
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const limited = await addressLookupLimit(request, env, id, origin);
      if (limited) return limited;
      try {
        const result = await catalogCore(env.CORE).searchAddressCandidates({
          requestId: id,
          query,
        });
        return privateJson(
          result,
          result.ok ? 200 : result.error.code.startsWith("GEOCODER_") ? 503 : 400,
          id,
          origin,
        );
      } catch {
        return privateJson(
          { ok: false, error: { code: "LOCATION_UNAVAILABLE" }, requestId: id },
          503,
          id,
          origin,
        );
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/location/confirm") {
      const origin = browserOrigin(request);
      if (origin === "") return new Response(null, { status: 403 });
      const body = await boundedJson(request);
      const point = coordinate(
        body && typeof body === "object" ? (body as Record<string, unknown>).coordinate : null,
      );
      if (!point)
        return privateJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400, id, origin);
      const limited = await addressLookupLimit(request, env, id, origin);
      if (limited) return limited;
      try {
        const result = await catalogCore(env.CORE).confirmBrowsingLocation({
          requestId: id,
          coordinate: point,
        });
        return privateJson(
          result,
          result.ok ? 200 : result.error.code.startsWith("GEOCODER_") ? 503 : 400,
          id,
          origin,
        );
      } catch {
        return privateJson(
          { ok: false, error: { code: "LOCATION_UNAVAILABLE" }, requestId: id },
          503,
          id,
          origin,
        );
      }
    }
    if (request.method !== "GET") {
      return publicJson(
        { ok: false, error: { code: "METHOD_NOT_ALLOWED" }, requestId: id },
        405,
        id,
      );
    }

    try {
      const token = browsingContext(request);
      if (token === null) return invalid(id);
      if (url.pathname === "/v1/catalog/home") {
        if (url.search) return invalid(id);
        const result = await catalogCore(env.CORE).getMarketplaceHome({
          requestId: id,
          itemsPerRail: 8,
          browsingContextToken: token,
        });
        return publicJson(result, readStatus(result), id);
      }
      if (url.pathname === "/v1/catalog/search") {
        const query = url.searchParams.get("q")?.trim() ?? "";
        const categorySlug = url.searchParams.get("category")?.trim() ?? "";
        const cursor = url.searchParams.get("cursor")?.trim() ?? "";
        if (
          query.length > 120 ||
          categorySlug.length > 80 ||
          cursor.length > 2048 ||
          [...url.searchParams.keys()].some(
            (key) => key !== "q" && key !== "category" && key !== "cursor",
          )
        )
          return invalid(id);
        const result = await catalogCore(env.CORE).searchMarketplace({
          requestId: id,
          query: query || undefined,
          categorySlug: categorySlug || undefined,
          cursor: cursor || undefined,
          limit: 24,
          browsingContextToken: token,
        });
        return publicJson(result, readStatus(result), id);
      }
      if (url.pathname === "/v1/catalog/product") {
        const slug = url.searchParams.get("slug")?.trim() ?? "";
        if (
          !slug ||
          slug.length > 120 ||
          [...url.searchParams.keys()].some((key) => key !== "slug")
        )
          return invalid(id);
        const result = await catalogCore(env.CORE).getCatalogProduct({
          requestId: id,
          slug,
          browsingContextToken: token,
        });
        return publicJson(result, readStatus(result), id);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "mobile_api.catalog_read_failed",
          requestId: id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      return publicJson(
        { ok: false, error: { code: "CATALOG_UNAVAILABLE" }, requestId: id },
        503,
        id,
      );
    }

    return publicJson({ ok: false, error: { code: "NOT_FOUND" }, requestId: id }, 404, id);
  },
} satisfies ExportedHandler<Cloudflare.Env>;

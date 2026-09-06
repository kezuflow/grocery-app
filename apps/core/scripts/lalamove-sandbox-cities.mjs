import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const sandboxOrigin = "https://rest.sandbox.lalamove.com";
const devVarsUrl = new URL("../.dev.vars", import.meta.url);

function parseDevVars(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1);
    values.set(match[1], value);
  }
  return values;
}

function required(values, name) {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function measure(value) {
  const item = object(value);
  return item ? { value: text(item.value), unit: text(item.unit) } : null;
}

const values = parseDevVars(await readFile(devVarsUrl, "utf8"));
const apiKey = required(values, "LALAMOVE_API_KEY");
const apiSecret = required(values, "LALAMOVE_API_SECRET");
const market = values.get("LALAMOVE_MARKET")?.trim() || "PH";

async function call(method, path, body = "") {
  const timestamp = String(Date.now());
  const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  const signature = createHmac("sha256", apiSecret).update(rawSignature).digest("hex");
  const response = await fetch(`${sandboxOrigin}${path}`, {
    method,
    headers: {
      Authorization: `hmac ${apiKey}:${timestamp}:${signature}`,
      Market: market,
      "Request-ID": randomUUID(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const responseText = await response.text();
  if (responseText.length > 1024 * 1024) throw new Error("LALAMOVE_RESPONSE_TOO_LARGE");
  let payload;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new Error(`LALAMOVE_INVALID_JSON_HTTP_${response.status}`);
  }
  if (!response.ok) {
    const root = object(payload);
    const errors = Array.isArray(root?.errors) ? root.errors : [];
    const safeErrors = errors.map((entry) => {
      const item = object(entry);
      return { id: text(item?.id), message: text(item?.message) };
    });
    console.error(
      JSON.stringify({
        ok: false,
        status: response.status,
        requestId: response.headers.get("request-id"),
        errors: safeErrors,
      }),
    );
    process.exit(1);
  }
  return { payload, requestId: response.headers.get("request-id") };
}

if (process.argv.includes("--quote")) {
  const serviceType = required(values, "LALAMOVE_SERVICE_TYPE");
  const language = values.get("LALAMOVE_LANGUAGE")?.trim() || "en_PH";
  const body = JSON.stringify({
    data: {
      serviceType,
      language,
      stops: [
        {
          coordinates: { lat: "10.3157", lng: "123.8854" },
          address: "FreshMarkets sandbox origin, Cebu City, Philippines",
        },
        {
          coordinates: { lat: "10.3173", lng: "123.9058" },
          address: "FreshMarkets sandbox destination, Cebu City, Philippines",
        },
      ],
    },
  });
  const result = await call("POST", "/v3/quotations", body);
  const root = object(result.payload);
  const data = object(root?.data);
  const price = object(data?.priceBreakdown);
  const stops = Array.isArray(data?.stops) ? data.stops : [];
  console.log(
    JSON.stringify({
      ok: true,
      market,
      serviceType: text(data?.serviceType),
      currency: text(price?.currency),
      total: text(price?.total),
      stopCount: stops.length,
      specialRequests: Array.isArray(data?.specialRequests) ? data.specialRequests : [],
      expiresAt: text(data?.expiresAt),
      requestId: result.requestId,
    }),
  );
} else {
  const result = await call("GET", "/v3/cities");
  const root = object(result.payload);
  const cities = Array.isArray(root?.data) ? root.data.map(object).filter(Boolean) : [];
  const cebu = cities.filter((city) => {
    const identity = [text(city.name), text(city.locode), text(city.city)]
      .filter(Boolean)
      .join(" ");
    return /cebu/i.test(identity);
  });
  const output = cebu.map((city) => ({
    name: text(city.name) ?? text(city.city),
    locode: text(city.locode),
    services: (Array.isArray(city.services) ? city.services : [])
      .map(object)
      .filter(Boolean)
      .map((service) => ({
        key: text(service.key),
        description: text(service.description),
        dimensions: (() => {
          const dimensions = object(service.dimensions);
          return dimensions
            ? {
                length: measure(dimensions.length),
                width: measure(dimensions.width),
                height: measure(dimensions.height),
              }
            : null;
        })(),
        load: measure(service.load),
        specialRequests: (Array.isArray(service.specialRequests) ? service.specialRequests : [])
          .map(object)
          .filter(Boolean)
          .map((specialRequest) => ({
            name: text(specialRequest.name),
            description: text(specialRequest.description),
            parentType: text(specialRequest.parent_type),
            maxSelection:
              typeof specialRequest.max_selection === "number"
                ? specialRequest.max_selection
                : null,
            effectiveTime: text(specialRequest.effective_time),
            offlineTime: text(specialRequest.offline_time),
          })),
        deliveryItemSpecification: object(service.deliveryItemSpecification),
      })),
  }));
  console.log(
    JSON.stringify({
      ok: true,
      market,
      cityCount: cities.length,
      cebu: output,
      requestId: result.requestId,
    }),
  );
}

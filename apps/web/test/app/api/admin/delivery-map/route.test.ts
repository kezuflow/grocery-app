import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  getDeliveryMap: vi.fn(),
  getDeliveryMapDetail: vi.fn(),
  getEligibleRiders: vi.fn(),
  previewDeliveryBatchRoute: vi.fn(),
  createAndAssignDeliveryBatch: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: core } }));

import { GET as getMap } from "@/app/api/admin/delivery-map/route";
import { GET as getDetail } from "@/app/api/admin/delivery-map/detail/route";
import { POST as previewRoute } from "@/app/api/admin/delivery-map/route-preview/route";
import { GET as getRiders, POST as createBatch } from "@/app/api/admin/delivery-batches/route";

const base = "https://freshmarkets.ph/api/admin";
const success = { ok: true, value: [], requestId: "core-request" } as const;
const REVISION_A = "a".repeat(64);
const REVISION_B = "b".repeat(64);
const GENERATED_AT = "2026-08-30T00:00:00.000Z";

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${base}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function malformedRequest(path: string) {
  return new Request(`${base}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
}

function instantContext() {
  return { locationId: "location-1", fulfillmentMode: "INSTANT" as const, cycleId: null };
}

function scheduledContext() {
  return {
    locationId: "location-1",
    fulfillmentMode: "SCHEDULED" as const,
    cycleId: "cycle-1",
  };
}

function delivery(jobId = "job-1", expectedVersion = 2) {
  return { jobId, expectedVersion };
}

function mapPin(jobId: string) {
  return {
    jobId,
    orderId: `order-${jobId}`,
    batchId: null,
    coordinate: { latitude: 10.31, longitude: 123.88 },
    fulfillmentMode: "INSTANT" as const,
    cycleId: null,
    status: "UNASSIGNED" as const,
    rider: null,
    version: 1,
    selection: { selectable: true, reason: null },
  };
}

function mapPage(
  pins: ReadonlyArray<ReturnType<typeof mapPin> | Record<string, unknown>>,
  nextCursor: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...instantContext(),
    pins,
    nextCursor,
    complete: nextCursor === null,
    projectionRevision: REVISION_A,
    totalCount: pins.length,
    generatedAt: GENERATED_AT,
    ...overrides,
  };
}

function rider(riderId: string, displayName = riderId) {
  return { riderId, displayName, openBatchCount: 0, openDeliveryCount: 0 };
}

function riderPage(
  riders: ReadonlyArray<ReturnType<typeof rider> | Record<string, unknown>>,
  nextCursor: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    riders,
    nextCursor,
    complete: nextCursor === null,
    projectionRevision: REVISION_A,
    totalCount: riders.length,
    ...overrides,
  };
}

function expectGeneratedRequest(call: unknown) {
  expect(call).toEqual(expect.objectContaining({ requestId: expect.any(String) }));
  expect((call as { requestId: string }).requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
}

async function expectValidation(response: Response, method: ReturnType<typeof vi.fn>) {
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_FAILED", requestId: expect.any(String) },
  });
  expect(method).not.toHaveBeenCalled();
}

beforeEach(() => {
  for (const method of Object.values(core)) method.mockReset().mockResolvedValue(success);
});

describe("GET /api/admin/delivery-map", () => {
  it("aggregates every bounded Core page before returning a complete operational map", async () => {
    const firstPin = {
      jobId: "job-0001",
      orderId: "order-0001",
      batchId: null,
      coordinate: { latitude: 10.31, longitude: 123.88 },
      fulfillmentMode: "INSTANT",
      cycleId: null,
      status: "UNASSIGNED",
      rider: null,
      version: 1,
      selection: { selectable: true, reason: null },
    };
    core.getDeliveryMap
      .mockResolvedValueOnce({
        ok: true,
        value: {
          ...instantContext(),
          pins: [firstPin],
          nextCursor: "map-page-2",
          complete: false,
          projectionRevision: REVISION_A,
          totalCount: 2,
          generatedAt: GENERATED_AT,
        },
        requestId: "core-map-1",
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          ...instantContext(),
          pins: [{ ...firstPin, jobId: "job-1001", orderId: "order-1001" }],
          nextCursor: null,
          complete: true,
          projectionRevision: REVISION_A,
          totalCount: 2,
          generatedAt: GENERATED_AT,
        },
        requestId: "core-map-2",
      });

    const response = await getMap(
      new Request(`${base}/delivery-map?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      value: {
        pins: [{ jobId: "job-0001" }, { jobId: "job-1001" }],
        nextCursor: null,
        complete: true,
      },
    });
    expect(core.getDeliveryMap).toHaveBeenCalledTimes(2);
    expect(core.getDeliveryMap.mock.calls[1][0]).toMatchObject({ cursor: "map-page-2" });
  });

  it("fails closed when Core pagination repeats or contradicts continuation evidence", async () => {
    core.getDeliveryMap.mockResolvedValue({
      ok: true,
      value: {
        ...instantContext(),
        pins: [
          {
            jobId: "job-loop",
            orderId: "order-loop",
            batchId: null,
            coordinate: null,
            fulfillmentMode: "INSTANT",
            cycleId: null,
            status: "UNASSIGNED",
            rider: null,
            version: 1,
            selection: { selectable: false, reason: "MISSING_COORDINATE" },
          },
        ],
        nextCursor: "same-cursor",
        complete: false,
        projectionRevision: REVISION_A,
        totalCount: 2,
        generatedAt: GENERATED_AT,
      },
      requestId: "core-map-loop",
    });
    const response = await getMap(
      new Request(`${base}/delivery-map?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(core.getDeliveryMap).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "a malformed entry",
      [mapPage([{ ...mapPin("job-0001"), version: "1" }], null, { totalCount: 1 })],
    ],
    [
      "a duplicate immutable job ID",
      [
        mapPage([mapPin("job-0001")], "cursor-2", { totalCount: 2 }),
        mapPage([mapPin("job-0001")], null, { totalCount: 2 }),
      ],
    ],
    [
      "a regressing immutable job ID",
      [
        mapPage([mapPin("job-0002")], "cursor-2", { totalCount: 2 }),
        mapPage([mapPin("job-0001")], null, { totalCount: 2 }),
      ],
    ],
    [
      "unique-cursor entity non-progress",
      [
        mapPage([mapPin("job-0001")], "unique-cursor-2", { totalCount: 2 }),
        mapPage([mapPin("job-0001")], null, { totalCount: 2 }),
      ],
    ],
    [
      "a mixed authoritative revision",
      [
        mapPage([mapPin("job-0001")], "cursor-2", { totalCount: 2 }),
        mapPage([mapPin("job-0002")], null, {
          projectionRevision: REVISION_B,
          totalCount: 2,
        }),
      ],
    ],
    [
      "a mixed source watermark",
      [
        mapPage([mapPin("job-0001")], "cursor-2", { totalCount: 2 }),
        mapPage([mapPin("job-0002")], null, {
          totalCount: 2,
          generatedAt: "2026-08-30T00:00:01.000Z",
        }),
      ],
    ],
  ])("fails closed on %s", async (_name, pages) => {
    for (const page of pages) {
      core.getDeliveryMap.mockResolvedValueOnce({ ok: true, value: page, requestId: "core-map" });
    }
    const response = await getMap(
      new Request(`${base}/delivery-map?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("fails closed at the bounded Core-page ceiling without requesting a partial tail", async () => {
    core.getDeliveryMap.mockImplementation(async () => {
      const page = core.getDeliveryMap.mock.calls.length;
      const last = page === 21;
      return {
        ok: true,
        value: mapPage(
          [mapPin(`job-${page.toString().padStart(4, "0")}`)],
          last ? null : `cursor-${page + 1}`,
          {
            totalCount: 21,
          },
        ),
        requestId: `core-map-${page}`,
      };
    });
    const response = await getMap(
      new Request(`${base}/delivery-map?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(core.getDeliveryMap).toHaveBeenCalledTimes(20);
  });

  it("fails closed before materializing an authoritative delivery item-count overflow", async () => {
    core.getDeliveryMap.mockResolvedValue({
      ok: true,
      value: mapPage([mapPin("job-0001")], null, { totalCount: 5_001 }),
      requestId: "core-map-overflow",
    });
    const response = await getMap(
      new Request(`${base}/delivery-map?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("rejects an oversized physical pin array before traversing any entry", async () => {
    let deepEntryReads = 0;
    const oversizedPins = new Proxy(
      Array.from({ length: 251 }, (_, index) => mapPin(`job-${index.toString().padStart(4, "0")}`)),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) deepEntryReads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    core.getDeliveryMap.mockResolvedValue({
      ok: true,
      value: mapPage(oversizedPins, null, { totalCount: 251 }),
      requestId: "core-map-oversized-page",
    });
    const response = await getMap(
      new Request(`${base}/delivery-map?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(deepEntryReads).toBe(0);
  });

  it("forwards one generated request identity, only safe headers, Instant context, and optional filters", async () => {
    const response = await getMap(
      new Request(
        `${base}/delivery-map?locationId=location-1&fulfillmentMode=INSTANT&statuses=UNASSIGNED&statuses=ASSIGNED&riderId=rider-1`,
        {
          headers: {
            cookie: "session=private",
            origin: "https://freshmarkets.ph",
            authorization: "Bearer secret",
            "x-unsafe": "secret",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(core.getDeliveryMap).toHaveBeenCalledTimes(1);
    const call = core.getDeliveryMap.mock.calls[0][0];
    expectGeneratedRequest(call);
    expect(call).toEqual({
      requestId: call.requestId,
      headers: {
        cookie: "session=private",
        origin: "https://freshmarkets.ph",
        "x-request-id": call.requestId,
      },
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      statuses: ["UNASSIGNED", "ASSIGNED"],
      riderId: "rider-1",
    });
  });

  it("forwards Scheduled context without inventing filters", async () => {
    await getMap(
      new Request(
        `${base}/delivery-map?locationId=location-1&fulfillmentMode=SCHEDULED&cycleId=cycle-1`,
      ),
    );
    const call = core.getDeliveryMap.mock.calls[0][0];
    expect(call).toMatchObject(scheduledContext());
    expect(call).not.toHaveProperty("statuses");
    expect(call).not.toHaveProperty("riderId");
  });

  it.each([
    ["missing location", "fulfillmentMode=INSTANT"],
    ["blank location", "locationId=%20&fulfillmentMode=INSTANT"],
    ["oversized location", `locationId=${"a".repeat(201)}&fulfillmentMode=INSTANT`],
    ["missing mode", "locationId=location-1"],
    ["invalid mode", "locationId=location-1&fulfillmentMode=WEEKLY"],
    ["Instant with cycle", "locationId=location-1&fulfillmentMode=INSTANT&cycleId=cycle-1"],
    ["Scheduled without cycle", "locationId=location-1&fulfillmentMode=SCHEDULED"],
    ["Scheduled blank cycle", "locationId=location-1&fulfillmentMode=SCHEDULED&cycleId=%20"],
    [
      "Scheduled oversized cycle",
      `locationId=location-1&fulfillmentMode=SCHEDULED&cycleId=${"a".repeat(201)}`,
    ],
    ["invalid status", "locationId=location-1&fulfillmentMode=INSTANT&statuses=OPEN"],
    ["blank status", "locationId=location-1&fulfillmentMode=INSTANT&statuses=%20"],
    ["oversized rider", `locationId=location-1&fulfillmentMode=INSTANT&riderId=${"a".repeat(201)}`],
  ])("rejects %s", async (_name, query) => {
    await expectValidation(
      await getMap(new Request(`${base}/delivery-map?${query}`)),
      core.getDeliveryMap,
    );
  });

  it.each([
    ["arbitrary", "unknown=private-value"],
    ["origin", "origin=private-origin"],
    ["latitude", "latitude=10.3"],
    ["longitude", "longitude=123.9"],
    ["optimization", "optimize=true"],
    ["optimization alias", "optimization=shortest"],
    ["provider", "provider=mapbox"],
  ])(
    "rejects unknown %s query input without reflecting it or calling Core",
    async (_name, input) => {
      const response = await getMap(
        new Request(`${base}/delivery-map?locationId=location-1&fulfillmentMode=INSTANT&${input}`),
      );
      const serialized = JSON.stringify(await response.clone().json());
      expect(response.status).toBe(400);
      expect(serialized).toContain("VALIDATION_FAILED");
      expect(serialized).not.toContain(input.split("=")[1]);
      expect(core.getDeliveryMap).not.toHaveBeenCalled();
    },
  );

  it("returns Core authentication failure unchanged at the adapter transport status", async () => {
    const result = {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in", requestId: "core-auth" },
    };
    core.getDeliveryMap.mockResolvedValue(result);
    const response = await getMap(
      new Request(`${base}/delivery-map?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });
});

describe("GET /api/admin/delivery-map/detail", () => {
  it("forwards the exact context, bounded job, and strictly parsed positive version", async () => {
    await getDetail(
      new Request(
        `${base}/delivery-map/detail?locationId=location-1&fulfillmentMode=SCHEDULED&cycleId=cycle-1&jobId=job-1&expectedVersion=17`,
        { headers: { cookie: "session=private", "x-request-id": "browser-request" } },
      ),
    );
    const call = core.getDeliveryMapDetail.mock.calls[0][0];
    expectGeneratedRequest(call);
    expect(call).toEqual({
      requestId: call.requestId,
      headers: { cookie: "session=private", "x-request-id": call.requestId },
      ...scheduledContext(),
      jobId: "job-1",
      expectedVersion: 17,
    });
  });

  it.each([
    ["missing job", ""],
    ["blank job", "&jobId=%20&expectedVersion=1"],
    ["oversized job", `&jobId=${"a".repeat(201)}&expectedVersion=1`],
    ["missing version", "&jobId=job-1"],
    ["zero version", "&jobId=job-1&expectedVersion=0"],
    ["negative version", "&jobId=job-1&expectedVersion=-1"],
    ["fractional version", "&jobId=job-1&expectedVersion=1.5"],
    ["partial version", "&jobId=job-1&expectedVersion=1x"],
    ["unsafe version", `&jobId=job-1&expectedVersion=${Number.MAX_SAFE_INTEGER + 1}`],
  ])("rejects %s", async (_name, suffix) => {
    const response = await getDetail(
      new Request(
        `${base}/delivery-map/detail?locationId=location-1&fulfillmentMode=INSTANT${suffix}`,
      ),
    );
    await expectValidation(response, core.getDeliveryMapDetail);
  });

  it.each([
    ["statuses", "statuses=UNASSIGNED"],
    ["Rider", "riderId=rider-private"],
    ["coordinate", "latitude=10.3"],
    ["origin", "origin=private-origin"],
    ["optimization", "optimization=shortest"],
    ["provider", "provider=mapbox"],
    ["arbitrary", "unknown=private-value"],
  ])("rejects unknown %s query input without calling Core", async (_name, input) => {
    const response = await getDetail(
      new Request(
        `${base}/delivery-map/detail?locationId=location-1&fulfillmentMode=INSTANT&jobId=job-1&expectedVersion=1&${input}`,
      ),
    );
    const serialized = JSON.stringify(await response.clone().json());
    await expectValidation(response, core.getDeliveryMapDetail);
    expect(serialized).not.toContain(input.split("=")[1]);
  });

  it("forwards Core forbidden and not-found results unchanged", async () => {
    for (const code of ["FORBIDDEN", "NOT_FOUND"] as const) {
      const result = { ok: false, error: { code, message: code, requestId: `core-${code}` } };
      core.getDeliveryMapDetail.mockResolvedValueOnce(result);
      const response = await getDetail(
        new Request(
          `${base}/delivery-map/detail?locationId=location-1&fulfillmentMode=INSTANT&jobId=job-1&expectedVersion=1`,
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
    }
  });
});

describe("POST /api/admin/delivery-map/route-preview", () => {
  it("forwards exact Scheduled context and preserves manual order", async () => {
    const orderedDeliveries = [delivery("job-2", 4), delivery("job-1", 8)];
    await previewRoute(
      jsonRequest(
        "delivery-map/route-preview",
        { ...scheduledContext(), orderedDeliveries },
        {
          cookie: "session=private",
        },
      ),
    );
    const call = core.previewDeliveryBatchRoute.mock.calls[0][0];
    expectGeneratedRequest(call);
    expect(call).toEqual({
      requestId: call.requestId,
      headers: {
        "content-type": "application/json",
        cookie: "session=private",
        "x-request-id": call.requestId,
      },
      ...scheduledContext(),
      orderedDeliveries,
    });
  });

  it.each([
    ["malformed JSON", () => malformedRequest("delivery-map/route-preview")],
    ["null", () => jsonRequest("delivery-map/route-preview", null)],
    ["array", () => jsonRequest("delivery-map/route-preview", [])],
    [
      "unknown body key",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery()],
          status: "UNASSIGNED",
        }),
    ],
    [
      "empty deliveries",
      () =>
        jsonRequest("delivery-map/route-preview", { ...instantContext(), orderedDeliveries: [] }),
    ],
    [
      "25 deliveries",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: Array.from({ length: 25 }, (_, index) => delivery(`job-${index}`)),
        }),
    ],
    [
      "duplicate jobs",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery(), delivery()],
        }),
    ],
    [
      "coordinate injection",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [{ ...delivery(), coordinate: { latitude: 10, longitude: 123 } }],
        }),
    ],
    [
      "origin injection",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery()],
          origin: [123, 10],
        }),
    ],
    [
      "optimization injection",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery()],
          optimize: true,
        }),
    ],
    [
      "rider injection",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery()],
          riderId: "rider-1",
        }),
    ],
    [
      "idempotency injection",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery()],
          idempotencyKey: "key",
        }),
    ],
    [
      "blank job",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery(" ")],
        }),
    ],
    [
      "oversized job",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery("a".repeat(201))],
        }),
    ],
    [
      "unknown delivery key",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [{ ...delivery(), sequence: 1 }],
        }),
    ],
    [
      "zero version",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery("job-1", 0)],
        }),
    ],
    [
      "negative version",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery("job-1", -1)],
        }),
    ],
    [
      "fractional version",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery("job-1", 1.5)],
        }),
    ],
    [
      "unsafe version",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          orderedDeliveries: [delivery("job-1", Number.MAX_SAFE_INTEGER + 1)],
        }),
    ],
    [
      "invalid Instant cycle",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...instantContext(),
          cycleId: "cycle-1",
          orderedDeliveries: [delivery()],
        }),
    ],
    [
      "invalid Scheduled cycle",
      () =>
        jsonRequest("delivery-map/route-preview", {
          ...scheduledContext(),
          cycleId: null,
          orderedDeliveries: [delivery()],
        }),
    ],
  ])("rejects %s before Core", async (_name, makeRequest) => {
    await expectValidation(await previewRoute(makeRequest()), core.previewDeliveryBatchRoute);
  });

  it("leaves an informational preview warning unchanged", async () => {
    const result = {
      ok: true,
      value: {
        outcome: "WARNING",
        geometry: null,
        totalMeters: null,
        totalSeconds: null,
        legs: [],
        warning: { code: "ROUTE_UNAVAILABLE", message: "Try manual ordering" },
      },
      requestId: "core-preview",
    };
    core.previewDeliveryBatchRoute.mockResolvedValue(result);
    const response = await previewRoute(
      jsonRequest("delivery-map/route-preview", {
        ...instantContext(),
        orderedDeliveries: [delivery()],
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });
});

describe("/api/admin/delivery-batches", () => {
  it("aggregates every bounded Rider page before returning a complete candidate set", async () => {
    core.getEligibleRiders
      .mockResolvedValueOnce({
        ok: true,
        value: {
          riders: [
            {
              riderId: "rider-0001",
              displayName: "Rider 0001",
              openBatchCount: 0,
              openDeliveryCount: 0,
            },
          ],
          nextCursor: "riders-page-2",
          complete: false,
          projectionRevision: REVISION_A,
          totalCount: 2,
        },
        requestId: "core-riders-1",
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          riders: [
            {
              riderId: "rider-0501",
              displayName: "Rider 0501",
              openBatchCount: 0,
              openDeliveryCount: 0,
            },
          ],
          nextCursor: null,
          complete: true,
          projectionRevision: REVISION_A,
          totalCount: 2,
        },
        requestId: "core-riders-2",
      });

    const response = await getRiders(
      new Request(`${base}/delivery-batches?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      value: [{ riderId: "rider-0001" }, { riderId: "rider-0501" }],
    });
    expect(core.getEligibleRiders).toHaveBeenCalledTimes(2);
    expect(core.getEligibleRiders.mock.calls[1][0]).toMatchObject({ cursor: "riders-page-2" });
  });

  it("sorts Riders by mutable display name and immutable ID only after complete ID traversal", async () => {
    core.getEligibleRiders
      .mockResolvedValueOnce({
        ok: true,
        value: riderPage([rider("rider-0001", "Zulu Rider")], "riders-page-2", {
          totalCount: 2,
        }),
        requestId: "core-riders-1",
      })
      .mockResolvedValueOnce({
        ok: true,
        value: riderPage([rider("rider-0002", "Alpha Rider")], null, { totalCount: 2 }),
        requestId: "core-riders-2",
      });
    const response = await getRiders(
      new Request(`${base}/delivery-batches?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      value: [
        { riderId: "rider-0002", displayName: "Alpha Rider" },
        { riderId: "rider-0001", displayName: "Zulu Rider" },
      ],
    });
  });

  it.each([
    [
      "a malformed entry",
      [riderPage([{ ...rider("rider-0001"), openBatchCount: -1 }], null, { totalCount: 1 })],
    ],
    [
      "a duplicate immutable Rider ID",
      [
        riderPage([rider("rider-0001")], "cursor-2", { totalCount: 2 }),
        riderPage([rider("rider-0001")], null, { totalCount: 2 }),
      ],
    ],
    [
      "a regressing immutable Rider ID",
      [
        riderPage([rider("rider-0002")], "cursor-2", { totalCount: 2 }),
        riderPage([rider("rider-0001")], null, { totalCount: 2 }),
      ],
    ],
    [
      "unique-cursor entity non-progress",
      [
        riderPage([rider("rider-0001")], "unique-cursor-2", { totalCount: 2 }),
        riderPage([rider("rider-0001")], null, { totalCount: 2 }),
      ],
    ],
    [
      "a mixed authoritative revision",
      [
        riderPage([rider("rider-0001")], "cursor-2", { totalCount: 2 }),
        riderPage([rider("rider-0002")], null, {
          projectionRevision: REVISION_B,
          totalCount: 2,
        }),
      ],
    ],
  ])("fails closed on %s", async (_name, pages) => {
    for (const page of pages) {
      core.getEligibleRiders.mockResolvedValueOnce({
        ok: true,
        value: page,
        requestId: "core-riders",
      });
    }
    const response = await getRiders(
      new Request(`${base}/delivery-batches?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("fails closed at the bounded Rider page ceiling", async () => {
    core.getEligibleRiders.mockImplementation(async () => {
      const page = core.getEligibleRiders.mock.calls.length;
      const last = page === 11;
      return {
        ok: true,
        value: riderPage(
          [rider(`rider-${page.toString().padStart(4, "0")}`)],
          last ? null : `cursor-${page + 1}`,
          { totalCount: 11 },
        ),
        requestId: `core-riders-${page}`,
      };
    });
    const response = await getRiders(
      new Request(`${base}/delivery-batches?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(core.getEligibleRiders).toHaveBeenCalledTimes(10);
  });

  it("fails closed before materializing an authoritative Rider item-count overflow", async () => {
    core.getEligibleRiders.mockResolvedValue({
      ok: true,
      value: riderPage([rider("rider-0001")], null, { totalCount: 2_001 }),
      requestId: "core-riders-overflow",
    });
    const response = await getRiders(
      new Request(`${base}/delivery-batches?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("rejects an oversized physical Rider array before traversing any entry", async () => {
    let deepEntryReads = 0;
    const oversizedRiders = new Proxy(
      Array.from({ length: 201 }, (_, index) =>
        rider(`rider-${index.toString().padStart(4, "0")}`),
      ),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) deepEntryReads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    core.getEligibleRiders.mockResolvedValue({
      ok: true,
      value: riderPage(oversizedRiders, null, { totalCount: 201 }),
      requestId: "core-riders-oversized-page",
    });
    const response = await getRiders(
      new Request(`${base}/delivery-batches?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(deepEntryReads).toBe(0);
  });

  it("GET calls only getEligibleRiders with exact Instant context", async () => {
    await getRiders(
      new Request(`${base}/delivery-batches?locationId=location-1&fulfillmentMode=INSTANT`),
    );
    const call = core.getEligibleRiders.mock.calls[0][0];
    expectGeneratedRequest(call);
    expect(call).toMatchObject(instantContext());
    expect(core.getDeliveryMap).not.toHaveBeenCalled();
  });

  it("GET validates exact mode/cycle context and forwards Core forbidden unchanged", async () => {
    await expectValidation(
      await getRiders(
        new Request(`${base}/delivery-batches?locationId=location-1&fulfillmentMode=SCHEDULED`),
      ),
      core.getEligibleRiders,
    );
    const result = {
      ok: false,
      error: { code: "FORBIDDEN", message: "No access", requestId: "core-forbidden" },
    };
    core.getEligibleRiders.mockResolvedValue(result);
    const response = await getRiders(
      new Request(
        `${base}/delivery-batches?locationId=location-1&fulfillmentMode=SCHEDULED&cycleId=cycle-1`,
      ),
    );
    expect(await response.json()).toEqual(result);
  });

  it.each([
    ["statuses", "statuses=UNASSIGNED"],
    ["Rider", "riderId=rider-private"],
    ["coordinate", "longitude=123.9"],
    ["origin", "origin=private-origin"],
    ["optimization", "optimize=true"],
    ["provider", "provider=mapbox"],
    ["arbitrary", "unknown=private-value"],
  ])("GET rejects unknown %s query input without calling Core", async (_name, input) => {
    const response = await getRiders(
      new Request(
        `${base}/delivery-batches?locationId=location-1&fulfillmentMode=INSTANT&${input}`,
      ),
    );
    const serialized = JSON.stringify(await response.clone().json());
    await expectValidation(response, core.getEligibleRiders);
    expect(serialized).not.toContain(input.split("=")[1]);
  });

  it("POST forwards canonical Rider, versions, order, and a matching stable key", async () => {
    const orderedDeliveries = [delivery("job-2", 4), delivery("job-1", 8)];
    await createBatch(
      jsonRequest(
        "delivery-batches",
        {
          ...instantContext(),
          riderId: "rider-canonical",
          orderedDeliveries,
          idempotencyKey: "key-1",
        },
        { "idempotency-key": "key-1", cookie: "session=private" },
      ),
    );
    const call = core.createAndAssignDeliveryBatch.mock.calls[0][0];
    expectGeneratedRequest(call);
    expect(call).toEqual({
      requestId: call.requestId,
      headers: {
        "content-type": "application/json",
        cookie: "session=private",
        "x-request-id": call.requestId,
      },
      ...instantContext(),
      riderId: "rider-canonical",
      orderedDeliveries,
      idempotencyKey: "key-1",
    });
  });

  it("POST accepts a header-only stable key", async () => {
    await createBatch(
      jsonRequest(
        "delivery-batches",
        { ...scheduledContext(), riderId: "rider-1", orderedDeliveries: [delivery()] },
        { "idempotency-key": "header-key" },
      ),
    );
    expect(core.createAndAssignDeliveryBatch.mock.calls[0][0].idempotencyKey).toBe("header-key");
  });

  it("POST accepts an exact 200-character resolved header key", async () => {
    const idempotencyKey = "k".repeat(200);
    await createBatch(
      jsonRequest(
        "delivery-batches",
        { ...instantContext(), riderId: "rider-1", orderedDeliveries: [delivery()] },
        { "idempotency-key": idempotencyKey },
      ),
    );
    expect(core.createAndAssignDeliveryBatch.mock.calls[0][0].idempotencyKey).toBe(idempotencyKey);
  });

  it.each([
    ["blank", "   "],
    ["oversized", "k".repeat(201)],
  ])(
    "POST rejects a %s header-only key without calling Core or reflecting it",
    async (_name, key) => {
      const response = await createBatch(
        jsonRequest(
          "delivery-batches",
          { ...instantContext(), riderId: "rider-1", orderedDeliveries: [delivery()] },
          { "idempotency-key": key },
        ),
      );
      const serialized = JSON.stringify(await response.clone().json());
      expect(response.status).toBe(400);
      expect(serialized).toContain("VALIDATION_FAILED");
      expect(serialized).not.toContain(key);
      expect(core.createAndAssignDeliveryBatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing key", {}, {}],
    ["mismatched keys", { idempotencyKey: "body-key" }, { "idempotency-key": "header-key" }],
    ["blank rider", { riderId: " " }, { "idempotency-key": "key" }],
    ["oversized rider", { riderId: "a".repeat(201) }, { "idempotency-key": "key" }],
    ["unknown key", { unexpected: true }, { "idempotency-key": "key" }],
    ["empty jobs", { orderedDeliveries: [] }, { "idempotency-key": "key" }],
    [
      "25 jobs",
      {
        orderedDeliveries: Array.from({ length: 25 }, (_, index) => delivery(`job-${index}`)),
      },
      { "idempotency-key": "key" },
    ],
    [
      "duplicate jobs",
      { orderedDeliveries: [delivery(), delivery()] },
      { "idempotency-key": "key" },
    ],
    ["zero version", { orderedDeliveries: [delivery("job-1", 0)] }, { "idempotency-key": "key" }],
    [
      "unsafe version",
      { orderedDeliveries: [delivery("job-1", Number.MAX_SAFE_INTEGER + 1)] },
      { "idempotency-key": "key" },
    ],
    [
      "coordinate injection",
      {
        orderedDeliveries: [{ ...delivery(), coordinate: { latitude: 10.3, longitude: 123.9 } }],
      },
      { "idempotency-key": "key" },
    ],
    ["optimization injection", { optimize: true }, { "idempotency-key": "key" }],
  ])("POST rejects %s before Core", async (_name, bodyOverride, headers) => {
    const body = {
      ...instantContext(),
      riderId: "rider-1",
      orderedDeliveries: [delivery()],
      ...bodyOverride,
    };
    await expectValidation(
      await createBatch(jsonRequest("delivery-batches", body, headers)),
      core.createAndAssignDeliveryBatch,
    );
  });

  it.each([
    ["malformed JSON", malformedRequest("delivery-batches")],
    ["null", jsonRequest("delivery-batches", null)],
    ["array", jsonRequest("delivery-batches", [])],
  ])("POST rejects %s before Core", async (_name, request) => {
    await expectValidation(await createBatch(request), core.createAndAssignDeliveryBatch);
  });

  it("POST rejects missing canonical Rider and missing delivery fields before Core", async () => {
    const requests = [
      jsonRequest(
        "delivery-batches",
        { ...instantContext(), orderedDeliveries: [delivery()] },
        { "idempotency-key": "key" },
      ),
      jsonRequest(
        "delivery-batches",
        { ...instantContext(), riderId: "rider-1", orderedDeliveries: [{ expectedVersion: 1 }] },
        { "idempotency-key": "key" },
      ),
      jsonRequest(
        "delivery-batches",
        { ...instantContext(), riderId: "rider-1", orderedDeliveries: [{ jobId: "job-1" }] },
        { "idempotency-key": "key" },
      ),
    ];
    for (const request of requests) {
      await expectValidation(await createBatch(request), core.createAndAssignDeliveryBatch);
    }
  });

  it("returns stale and idempotency conflicts unchanged", async () => {
    for (const code of ["STALE_VERSION", "IDEMPOTENCY_CONFLICT"] as const) {
      const result = { ok: false, error: { code, message: code, requestId: `core-${code}` } };
      core.createAndAssignDeliveryBatch.mockResolvedValueOnce(result);
      const response = await createBatch(
        jsonRequest(
          "delivery-batches",
          { ...instantContext(), riderId: "rider-1", orderedDeliveries: [delivery()] },
          { "idempotency-key": "key" },
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
    }
  });
});

import type { ProviderEvent, ProviderProof } from "../../ports/provider-event";
import type { ProviderDeliveryStatus } from "../../ports/delivery-provider";
import type { ObservedDeliveryStop } from "../../ports/delivery-provider";

export function lalamoveObservedStops(
  order: Record<string, unknown>,
): ObservedDeliveryStop[] | undefined {
  if (!Array.isArray(order.stops) || order.stops.length < 2 || order.stops.length > 16)
    return undefined;
  const result: ObservedDeliveryStop[] = [];
  for (const [position, value] of order.stops.entries()) {
    const stop = providerObject(value);
    const coordinates = providerObject(stop?.coordinates);
    const latitude = Number(coordinates?.lat);
    const longitude = Number(coordinates?.lng);
    const formattedAddress = providerString(stop?.address, 3000);
    if (
      !coordinates ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      !formattedAddress
    )
      return undefined;
    result.push({
      position,
      coordinate: { latitude, longitude },
      formattedAddress,
      name: providerString(stop?.name, 200),
      phone: providerString(stop?.phone, 32),
    });
  }
  return result;
}

export function providerObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function providerString(value: unknown, maximum = 128): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    ? value
    : null;
}
export function lalamoveStatus(value: unknown): ProviderDeliveryStatus | undefined {
  switch (value) {
    case "ASSIGNING_DRIVER":
      return "ALLOCATING";
    case "ON_GOING":
      return "PENDING_PICKUP";
    case "PICKED_UP":
      return "IN_DELIVERY";
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELED":
      return "CANCELED";
    case "REJECTED":
    case "EXPIRED":
      return "FAILED";
    default:
      return undefined;
  }
}
function evidenceUrl(value: unknown): string | null {
  const text = providerString(value, 4096);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? text
      : null;
  } catch {
    return null;
  }
}
export function lalamoveCost(value: unknown): ProviderEvent["evidence"] {
  const cost = providerObject(value);
  const total = cost?.totalPrice ?? cost?.total;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(total ?? ""));
  const amountMinor = match ? Number(`${match[1]}${(match[2] ?? "").padEnd(2, "0")}`) : NaN;
  return cost?.currency === "PHP" && Number.isSafeInteger(amountMinor) && amountMinor >= 0
    ? [{ kind: "COST", value: { currency: "PHP", amountMinor } }]
    : [];
}
export function lalamoveProofs(order: Record<string, unknown>): ProviderEvent["evidence"] {
  const stops = Array.isArray(order.stops) ? order.stops.slice(0, 16) : [];
  const delivery: ProviderProof[] = [];
  const pickup: ProviderProof[] = [];
  const codes: { stopIndex: number; status: string; value: string | null }[] = [];
  stops.forEach((raw, stopIndex) => {
    const stop = providerObject(raw);
    const pod = providerObject(stop?.POD ?? stop?.pod);
    const pop = providerObject(stop?.POP ?? stop?.pop);
    const code = providerObject(stop?.deliveryCode);
    if (pod)
      delivery.push({
        stopIndex,
        status: providerString(pod.status) ?? "UNKNOWN",
        imageUrls: [evidenceUrl(pod.image)].filter((v): v is string => v !== null),
        occurredAt: providerString(pod.deliveredAt),
      });
    if (pop)
      pickup.push({
        stopIndex,
        status: "RECEIVED",
        imageUrls: (Array.isArray(pop.imageUrls) ? pop.imageUrls.slice(0, 16) : [])
          .map(evidenceUrl)
          .filter((v): v is string => v !== null),
        occurredAt: providerString(pop.pickedUpAt),
      });
    if (code)
      codes.push({
        stopIndex,
        status: providerString(code.status) ?? "UNKNOWN",
        value: providerString(code.value, 128),
      });
  });
  return [
    ...(delivery.length ? [{ kind: "DELIVERY_PROOF" as const, value: delivery }] : []),
    ...(pickup.length ? [{ kind: "PICKUP_PROOF" as const, value: pickup }] : []),
    ...(codes.length ? [{ kind: "DELIVERY_CODE" as const, value: codes }] : []),
  ];
}
/** Official v3 envelopes differ by event type; authentication belongs to ingress. */
export function parseLalamoveEvent(payload: unknown): ProviderEvent | null {
  const root = providerObject(payload);
  const data = providerObject(root?.data);
  const order = providerObject(data?.order);
  const eventId = providerString(root?.eventId);
  const type = providerString(root?.eventType);
  const updatedAt = providerString(data?.updatedAt);
  let observedAt = updatedAt ? Date.parse(updatedAt) : NaN;
  // Actual PH sandbox v3 callbacks use HH:mm.ssZ, with a local clock
  // mislabeled Z. Preserve it in raw evidence, but order these callbacks by
  // their authenticated Unix timestamp instead of inventing a timezone.
  if (
    !Number.isFinite(observedAt) &&
    updatedAt &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\.\d{2}Z$/.test(updatedAt)
  ) {
    const timestamp = Number(root?.timestamp);
    observedAt =
      Number.isSafeInteger(timestamp) && timestamp > 0
        ? timestamp < 100_000_000_000
          ? timestamp * 1000
          : timestamp
        : NaN;
  }
  if (
    !eventId ||
    !type ||
    !data ||
    !Number.isSafeInteger(observedAt) ||
    observedAt < 0 ||
    (root?.eventVersion !== undefined && root.eventVersion !== "v3")
  )
    return null;
  const providerDeliveryId = providerString(order?.orderId, 64);
  const merchantOrderId = providerString(providerObject(order?.metadata)?.merchantOrderId, 200);
  const base = {
    eventId,
    providerDeliveryId,
    observedAt,
    ...(merchantOrderId ? { merchantOrderId } : {}),
  };
  if (type === "WALLET_BALANCE_CHANGED") return { ...base, kind: "WALLET" };
  if (!providerDeliveryId) return { ...base, kind: "UNKNOWN" };
  if (type === "ORDER_REPLACED") {
    const previousProviderDeliveryId = providerString(data.prevOrderId, 64);
    return previousProviderDeliveryId && previousProviderDeliveryId !== providerDeliveryId
      ? { ...base, kind: "REPLACEMENT", previousProviderDeliveryId }
      : null;
  }
  if (type === "DRIVER_ASSIGNED") {
    const driver = providerObject(data.driver);
    const driverId = providerString(driver?.driverId, 64) ?? providerString(order?.driverId, 64);
    return driverId
      ? {
          ...base,
          kind: "DRIVER",
          driverId,
          evidence: [
            {
              kind: "DRIVER",
              value: {
                driverId,
                name: providerString(driver?.name, 120),
                phone: providerString(driver?.phone, 32),
                plateNumber: providerString(driver?.plateNumber, 64),
              },
            },
          ],
        }
      : { ...base, kind: "UNKNOWN" };
  }
  const proofs = order ? lalamoveProofs(order) : [];
  const observedStops = order ? lalamoveObservedStops(order) : undefined;
  if (type === "ORDER_STATUS_CHANGED" || type === "ORDER_CREATED") {
    const status = lalamoveStatus(order?.status);
    return status
      ? {
          ...base,
          kind: type === "ORDER_CREATED" ? "CREATED" : "STATUS",
          status,
          driverId: providerString(order?.driverId, 64),
          trackingUrl: evidenceUrl(order?.shareLink),
          evidence: [
            ...(proofs ?? []),
            ...(lalamoveCost(order?.price ?? order?.priceBreakdown) ?? []),
          ],
          replacementCheck:
            status === "CANCELED" && order?.cancelParty === "LALAMOVE_CUSTOMER_SUPPORT",
          ...(observedStops ? { observedStops } : {}),
        }
      : { ...base, kind: "UNKNOWN" };
  }
  if (type === "ORDER_AMOUNT_CHANGED") {
    const cost = lalamoveCost(order?.price ?? order?.priceBreakdown);
    return cost?.length
      ? { ...base, kind: "EVIDENCE", evidence: cost }
      : { ...base, kind: "UNKNOWN" };
  }
  if (type === "ORDER_EDITED")
    return { ...base, kind: "EVIDENCE", evidence: [{ kind: "EDIT", value: { changed: true } }] };
  if (["POD_STATUS_CHANGED", "POP_STATUS_CHANGED", "DELIVERY_CODE_STATUS_CHANGED"].includes(type))
    return proofs?.length
      ? { ...base, kind: "EVIDENCE", evidence: proofs, ...(observedStops ? { observedStops } : {}) }
      : { ...base, kind: "UNKNOWN" };
  return { ...base, kind: "UNKNOWN" };
}

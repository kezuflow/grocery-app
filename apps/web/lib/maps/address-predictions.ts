import { z } from "@freshmarkets/validation";

export const addressPredictionsSchema = z.object({
  ok: z.literal(true),
  value: z.array(z.object({ candidateKey: z.string(), displayAddress: z.string() })),
});
const nullableText = z.string().nullable();
const candidateSchema = z.object({
  ok: z.literal(true),
  value: z.object({
    candidateKey: z.string(),
    displayAddress: z.string(),
    coordinate: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
    components: z.object({
      addressLine1: z.string(),
      addressLine2: nullableText,
      barangay: nullableText,
      city: z.string(),
      region: nullableText,
      postalCode: nullableText,
      countryCode: z.string(),
    }),
    accuracy: nullableText,
  }),
});
export async function resolveAddressPrediction(
  candidateKey: string,
  sessionToken: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("/api/commerce/address-prediction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidateKey, sessionToken }),
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const parsed = candidateSchema.safeParse(await response.json());
  if (!response.ok || !parsed.success)
    throw new Error("Address details could not be loaded. Try the suggestion again.");
  return parsed.data.value;
}

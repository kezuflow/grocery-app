import { drizzle } from "drizzle-orm/d1";
import type {
  AddressReverseRequest,
  ConfirmedBrowsingLocation,
  RpcResult,
} from "@freshmarkets/contracts";
import type { GeocoderPort } from "../ports/geocoder";
import { GeocoderError } from "../infrastructure/geocoder-error";
import { resolveServiceability } from "../serviceability";

/** No provider-derived browser data may be retained before this confirmation. */
export async function confirmBrowsingLocation(
  dependencies: { db: D1Database; geocoder: GeocoderPort },
  input: AddressReverseRequest,
): Promise<RpcResult<ConfirmedBrowsingLocation>> {
  try {
    const permanent = await dependencies.geocoder.reversePermanent(input);
    // Keep the customer's entrance, not the provider's nearby address centroid.
    const resolution = await resolveServiceability(drizzle(dependencies.db), {
      ...input.coordinate,
      requestId: input.requestId,
    });
    if (!resolution.ok) return resolution;
    return {
      ok: true,
      requestId: input.requestId,
      value: {
        displayAddress: permanent.displayAddress,
        coordinate: input.coordinate,
        serviceability: resolution.value,
      },
    };
  } catch (error) {
    if (!(error instanceof GeocoderError)) throw error;
    return {
      ok: false,
      error: {
        code: error.code,
        message: "Address confirmation is temporarily unavailable. Please try again.",
        requestId: input.requestId,
      },
    };
  }
}

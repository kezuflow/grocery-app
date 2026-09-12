import type {
  CatalogProductRequest,
  CatalogSearchRequest,
  MarketplaceHomeRequest,
  RequestMeta,
} from "@freshmarkets/contracts";
import {
  CatalogValidationError,
  getMarketplaceHome,
  getProduct,
  listCategories,
  searchCatalog,
} from "../catalog/service";
import {
  catalogProductRequestSchema,
  catalogSearchRequestSchema,
  marketplaceHomeRequestSchema,
} from "../validation";
import type { CoreRpcContext } from "./context";
import { rpcFailure, validationFailure } from "./validation-errors";
import { locationFromBrowsingContext } from "../geography/application/browsing-context";

async function catalogLocation(
  context: CoreRpcContext,
  input: { locationId?: string; browsingContextToken?: string },
): Promise<string | undefined> {
  if (!input.browsingContextToken) return input.locationId;
  return (
    (await locationFromBrowsingContext(
      context.runtimeConfiguration().auth.secret,
      input.browsingContextToken,
    )) ?? undefined
  );
}

export function createCatalogRpc(context: CoreRpcContext) {
  return {
    async searchCatalog(input: CatalogSearchRequest) {
      const validation = catalogSearchRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      try {
        const locationId = await catalogLocation(context, input);
        return {
          ok: true as const,
          value: await searchCatalog(context.env.DB, { ...input, locationId }),
          requestId: input.requestId,
        };
      } catch (error) {
        if (error instanceof CatalogValidationError)
          return rpcFailure("VALIDATION_FAILED", error.message, input.requestId);
        throw error;
      }
    },

    async getMarketplaceHome(input: MarketplaceHomeRequest) {
      const validation = marketplaceHomeRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      try {
        const locationId = await catalogLocation(context, input);
        return {
          ok: true as const,
          value: await getMarketplaceHome(context.env.DB, { ...input, locationId }),
          requestId: input.requestId,
        };
      } catch (error) {
        if (error instanceof CatalogValidationError)
          return rpcFailure("VALIDATION_FAILED", error.message, input.requestId);
        throw error;
      }
    },

    async getCatalogProduct(input: CatalogProductRequest) {
      const validation = catalogProductRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      const locationId = await catalogLocation(context, input);
      return {
        ok: true as const,
        value: await getProduct(context.env.DB, input.slug, locationId),
        requestId: input.requestId,
      };
    },

    async listCategories(input: RequestMeta) {
      return {
        ok: true as const,
        value: await listCategories(context.env.DB),
        requestId: input.requestId,
      };
    },
  };
}

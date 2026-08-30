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

export function createCatalogRpc(context: CoreRpcContext) {
  return {
    async searchCatalog(input: CatalogSearchRequest) {
      const validation = catalogSearchRequestSchema.safeParse(input);
      if (!validation.success) return validationFailure(input.requestId, validation.error);
      try {
        return {
          ok: true as const,
          value: await searchCatalog(context.env.DB, input),
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
        return {
          ok: true as const,
          value: await getMarketplaceHome(context.env.DB, input),
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
      return {
        ok: true as const,
        value: await getProduct(context.env.DB, input.slug, input.locationId),
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

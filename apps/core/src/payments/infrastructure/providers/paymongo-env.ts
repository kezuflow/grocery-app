/**
 * Environment contract for the PayMongo adapter. Values are provisioned as
 * Worker secrets (`wrangler secret put …`), never source defaults.
 */
export type PayMongoProviderEnvironment = {
  PAYMONGO_SECRET_KEY?: string;
  PAYMONGO_WEBHOOK_SECRET_TEST?: string;
  PAYMONGO_WEBHOOK_SECRET_LIVE?: string;
};

export type { PayMongoConfig } from "./paymongo-provider";

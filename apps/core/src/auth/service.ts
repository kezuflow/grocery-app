import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import type { Auth } from "better-auth";
import {
  createRuntimeAuthEmailDelivery,
  type AuthEmailDelivery,
  type AuthEmailMessage,
} from "./email-delivery";
import { trustedOriginsForEnvironment } from "./origins";
import { betterAuthSchema } from "./schema";
import { iamSchema } from "../iam/schema";

export type AuthEnvironment = {
  DB: D1Database;
  ENVIRONMENT?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  TRUSTED_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  EMAIL?: SendEmail;
  AUTH_EMAIL_FROM?: string;
};

const localSecret = "freshmarkets-phase1-local-secret-change-me";

export function createBetterAuthDatabase(env: AuthEnvironment) {
  return drizzle(env.DB, { schema: betterAuthSchema });
}

export function createAuth(
  env: AuthEnvironment,
  dependencies?: { authEmailDelivery?: AuthEmailDelivery },
): Auth<any> {
  const betterAuthDatabase = createBetterAuthDatabase(env);
  const iamDatabase = drizzle(env.DB, { schema: iamSchema });
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const environment = env.ENVIRONMENT ?? "development";
  const authEmailDelivery = dependencies?.authEmailDelivery ?? createRuntimeAuthEmailDelivery(env);
  const deliverAuthEmail = (
    data: { user: { email: string }; url: string },
    kind: AuthEmailMessage["kind"],
  ) => {
    const { email } = data.user;
    const bearerUrl = data.url;
    return authEmailDelivery.send({ kind, recipient: email, url: bearerUrl });
  };

  return betterAuth({
    appName: "FreshMarkets",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET ?? (environment === "production" ? undefined : localSecret),
    database: drizzleAdapter(betterAuthDatabase, {
      provider: "sqlite",
      schema: betterAuthSchema,
      transaction: false,
    }),
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await iamDatabase
              .insert(iamSchema.customerPrincipal)
              .values({
                id: crypto.randomUUID(),
                authUserId: user.id,
                status: "active",
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .onConflictDoNothing({ target: iamSchema.customerPrincipal.authUserId });
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async (data) => deliverAuthEmail(data, "reset"),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async (data) => deliverAuthEmail(data, "verification"),
    },
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            requireEmailVerification: true,
          },
        }
      : {},
    trustedOrigins: [...trustedOriginsForEnvironment(env)],
    advanced: {
      useSecureCookies: environment === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: environment === "production",
        path: "/",
      },
    },
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;

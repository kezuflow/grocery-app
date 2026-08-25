import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import type { Auth } from "better-auth";
import { log } from "../observability";
import { trustedOriginsForEnvironment } from "./origins";
import { authSchema } from "./schema";

export type AuthEnvironment = {
  DB: D1Database;
  ENVIRONMENT?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  TRUSTED_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

const localSecret = "freshmarkets-phase1-local-secret-change-me";

function originFromRequest(request?: Request): string | undefined {
  if (!request) return undefined;
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.slice(0, -1);
  const forwardedHost = request.headers.get("x-forwarded-host") ?? new URL(request.url).host;
  return `${forwardedProto}://${forwardedHost}`;
}

async function deliverAuthEmail(
  kind: "verification" | "reset",
  data: { user: { email: string }; url: string },
  request?: Request,
) {
  log("info", `auth.email.${kind}.requested`, {
    email: data.user.email,
    url: data.url,
    origin: originFromRequest(request),
  });
}

export function createAuth(env: AuthEnvironment): Auth<any> {
  const database = drizzle(env.DB, { schema: authSchema });
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const environment = env.ENVIRONMENT ?? "development";

  return betterAuth({
    appName: "FreshMarkets",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET ?? (environment === "production" ? undefined : localSecret),
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await database
              .insert(authSchema.customerPrincipal)
              .values({
                id: crypto.randomUUID(),
                authUserId: user.id,
                status: "active",
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .onConflictDoNothing({ target: authSchema.customerPrincipal.authUserId });
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async (data, request) => deliverAuthEmail("reset", data, request),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async (data, request) =>
        deliverAuthEmail("verification", data, request),
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

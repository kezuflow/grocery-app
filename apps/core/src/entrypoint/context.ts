import { drizzle } from "drizzle-orm/d1";
import type { AuthenticatedRequest, Capability } from "@freshmarkets/contracts";
import type { Clock } from "@freshmarkets/domain-shared";
import { systemClock } from "@freshmarkets/domain-shared";
import { applicationContext, hasOperationalScope } from "../auth/authorization";
import { createAuth, type AuthEnvironment } from "../auth/service";
import { iamSchema } from "../iam/schema";
import {
  coreRuntimeConfiguration,
  type CoreRuntimeConfiguration,
} from "../runtime/runtime-configuration";
import {
  buildProviderRegistry,
  selectedPaymentProviderCode,
} from "../payments/infrastructure/providers/runtime-providers";
import { buildRouteDistancePort } from "../geography/infrastructure/runtime-route-distance";
import {
  activeFulfillmentLocationId,
  activeMarketCode,
  fulfillmentLocationMarketId,
} from "../geography/market-defaults";
import {
  resolveAuthenticatedCustomer,
  type AuthenticatedCustomer,
  type ResolvedCustomer,
  type SessionUser,
} from "../customer/principal";

/**
 * The composed application context handed to every entrypoint RPC: the
 * request-scoped session, customer resolution, and capability/location-scope
 * authorization over the single D1 binding and Better Auth instance. This is
 * dependency composition only — domain behavior lives in the bounded-context
 * modules.
 */
export class CoreContext {
  private readonly env: Env & AuthEnvironment;
  readonly clock: Clock;

  constructor(env: Env & AuthEnvironment, clock: Clock = systemClock) {
    this.env = env;
    this.clock = clock;
  }

  now(): number {
    return this.clock.now().getTime();
  }

  async session(input: AuthenticatedRequest): Promise<SessionUser | null> {
    const authSession = await createAuth(this.env).api.getSession({
      headers: new Headers(input.headers),
    });
    return authSession?.user
      ? {
          id: authSession.user.id,
          email: authSession.user.email,
          name: authSession.user.name,
          emailVerified: authSession.user.emailVerified,
        }
      : null;
  }

  resolveAuthenticatedCustomer(input: AuthenticatedRequest): Promise<ResolvedCustomer> {
    return resolveAuthenticatedCustomer(this.env.DB, input, {
      getSessionUser: (headers) =>
        createAuth(this.env)
          .api.getSession({ headers })
          .then((authSession) =>
            authSession?.user
              ? {
                  id: authSession.user.id,
                  email: authSession.user.email,
                  name: authSession.user.name,
                  emailVerified: authSession.user.emailVerified,
                }
              : null,
          ),
      now: () => this.now(),
    });
  }

  /** Resolved authorization context when the capability is held, else null. */
  async requireCapability(input: AuthenticatedRequest, capability: Capability) {
    const context = await applicationContext(
      createAuth(this.env),
      drizzle(this.env.DB, { schema: iamSchema }),
      { headers: input.headers, requestId: input.requestId },
    );
    return context.ok &&
      context.value.authenticated &&
      context.value.capabilities.includes(capability)
      ? context.value
      : null;
  }

  /** Capability plus operational scope over the fulfillment location (its market scope accepted). */
  async requireOperationalAccess(
    input: AuthenticatedRequest,
    capability: Capability,
    locationId: string,
  ): Promise<boolean> {
    const context = await this.requireCapability(input, capability);
    if (!context) return false;
    const marketId = await fulfillmentLocationMarketId(this.env.DB, locationId);
    return hasOperationalScope(context.scopes, locationId, marketId ?? undefined);
  }

  /**
   * Delivery-job authorization: delivery capability with location scope, and
   * — for a job already assigned to a rider — either the assigned rider
   * themselves or an actor holding the supervisory orders.manage capability.
   * This enforces that riders act only on their own assignments.
   */
  async authorizeDeliveryJob(
    input: AuthenticatedRequest,
    job: { locationId: string; riderAuthUserId: string | null },
  ): Promise<boolean> {
    if (!(await this.requireOperationalAccess(input, "delivery.manage", job.locationId)))
      return false;
    if (job.riderAuthUserId === null) return true;
    const context = await applicationContext(
      createAuth(this.env),
      drizzle(this.env.DB, { schema: iamSchema }),
      { headers: input.headers, requestId: input.requestId },
    );
    if (!context.ok || !context.value.authenticated) return false;
    return (
      context.value.capabilities.includes("orders.manage") ||
      context.value.principal?.userId === job.riderAuthUserId
    );
  }

  /**
   * Resolve the board's effective location: an explicitly requested location
   * or the market's active default. Returns null when none is configured.
   */
  async resolveBoardLocation(requestedLocationId?: string | null): Promise<string | null> {
    if (requestedLocationId) return requestedLocationId;
    return activeFulfillmentLocationId(this.env.DB, await activeMarketCode(this.env.DB));
  }
}

export function createCoreContext(env: Env & AuthEnvironment, clock?: Clock): CoreContext {
  return new CoreContext(env, clock);
}

/** Stable dependency composition shared by bounded RPC transport adapters. */
export type CoreRpcContext = Readonly<{
  env: Env & AuthEnvironment;
  access: CoreContext;
  auth: ReturnType<typeof createAuth>;
  iamDatabase: ReturnType<typeof drizzle<typeof iamSchema>>;
  runtimeConfiguration: () => CoreRuntimeConfiguration;
  paymentProviders: () => ReturnType<typeof buildProviderRegistry>;
  paymentProviderCode: () => string | null;
  routeDistance: () => ReturnType<typeof buildRouteDistancePort>;
}>;

export function createCoreRpcContext(
  env: Env & AuthEnvironment,
  clock: Clock = systemClock,
): CoreRpcContext {
  let cachedRuntime: CoreRuntimeConfiguration | undefined;
  let cachedProviders: ReturnType<typeof buildProviderRegistry> | undefined;
  let cachedRouteDistance: ReturnType<typeof buildRouteDistancePort> | undefined;
  const runtimeConfiguration = () => (cachedRuntime ??= coreRuntimeConfiguration(env));
  return {
    env,
    access: createCoreContext(env, clock),
    auth: createAuth(env),
    iamDatabase: drizzle(env.DB, { schema: iamSchema }),
    runtimeConfiguration,
    paymentProviders: () => (cachedProviders ??= buildProviderRegistry(runtimeConfiguration())),
    paymentProviderCode: () => selectedPaymentProviderCode(runtimeConfiguration()),
    routeDistance: () => (cachedRouteDistance ??= buildRouteDistancePort(env)),
  };
}

export type { AuthenticatedCustomer, SessionUser };

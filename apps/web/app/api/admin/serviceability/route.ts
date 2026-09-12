import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";

const retired = (request: Request) =>
  adminJson({
    ok: false as const,
    error: {
      code: "NOT_FOUND" as const,
      message: "Service-area polygons are retired; configure fulfillment-location pins instead",
      requestId: webRequestId(request),
    },
  });

export const GET = observeAdminRoute("admin.serviceability.read", async (request: Request) =>
  retired(request),
);

export const POST = observeAdminRoute("admin.serviceability.command", async (request: Request) =>
  retired(request),
);

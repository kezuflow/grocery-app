import { getMessages, markRead, sendMessage } from "@/lib/http/order-messaging-routes";
import { observeAdminRoute } from "@/lib/http/admin-route-observability";
type Context = { params: Promise<{ "order-id": string }> };
export const GET = observeAdminRoute(
  "admin.messages.by_order_id.get",
  async (request: Request, context: Context) =>
    getMessages(request, "ADMIN", (await context.params)["order-id"]),
);
export const POST = observeAdminRoute(
  "admin.messages.by_order_id.post",
  async (request: Request, context: Context) =>
    sendMessage(request, "ADMIN", (await context.params)["order-id"]),
);
export const PATCH = observeAdminRoute(
  "admin.messages.by_order_id.patch",
  async (request: Request, context: Context) =>
    markRead(request, "ADMIN", (await context.params)["order-id"]),
);

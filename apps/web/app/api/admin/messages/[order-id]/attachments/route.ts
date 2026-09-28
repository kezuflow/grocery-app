import { stageAttachment } from "@/lib/http/order-messaging-routes";
import { observeAdminRoute } from "@/lib/http/admin-route-observability";
type Context = { params: Promise<{ "order-id": string }> };
export const POST = observeAdminRoute(
  "admin.messages.by_order_id.attachments.post",
  async (request: Request, context: Context) =>
    stageAttachment(request, "ADMIN", (await context.params)["order-id"]),
);

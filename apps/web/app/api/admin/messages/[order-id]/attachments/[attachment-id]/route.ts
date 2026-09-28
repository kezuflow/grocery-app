import { downloadAttachment } from "@/lib/http/order-messaging-routes";
import { observeAdminRoute } from "@/lib/http/admin-route-observability";
type Context = { params: Promise<{ "order-id": string; "attachment-id": string }> };
export const GET = observeAdminRoute(
  "admin.messages.by_order_id.attachments.by_attachment_id.get",
  async (request: Request, context: Context) => {
    const params = await context.params;
    return downloadAttachment(request, "ADMIN", params["order-id"], params["attachment-id"]);
  },
);

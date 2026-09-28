import { listConversations } from "@/lib/http/order-messaging-routes";
import { observeAdminRoute } from "@/lib/http/admin-route-observability";
export const GET = observeAdminRoute("admin.messages.get", (request: Request) =>
  listConversations(request, "ADMIN"),
);

import { getAcknowledgement, saveAcknowledgement } from "@/lib/http/order-messaging-routes";
import { observeAdminRoute } from "@/lib/http/admin-route-observability";
export const GET = observeAdminRoute("admin.messages.acknowledgement.get", getAcknowledgement);
export const PATCH = observeAdminRoute("admin.messages.acknowledgement.patch", saveAcknowledgement);

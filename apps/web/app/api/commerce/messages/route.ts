import { listConversations } from "@/lib/http/order-messaging-routes";
export const GET = (request: Request) => listConversations(request, "CUSTOMER");

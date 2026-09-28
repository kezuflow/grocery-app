import { downloadAttachment } from "@/lib/http/order-messaging-routes";
type Context = { params: Promise<{ "order-id": string; "attachment-id": string }> };
export const GET = async (request: Request, context: Context) => {
  const params = await context.params;
  return downloadAttachment(request, "CUSTOMER", params["order-id"], params["attachment-id"]);
};

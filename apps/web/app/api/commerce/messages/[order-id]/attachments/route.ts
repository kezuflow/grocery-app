import { stageAttachment } from "@/lib/http/order-messaging-routes";
type Context = { params: Promise<{ "order-id": string }> };
export const POST = async (request: Request, context: Context) =>
  stageAttachment(request, "CUSTOMER", (await context.params)["order-id"]);

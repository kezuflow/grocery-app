import { getMessages, markRead, sendMessage } from "@/lib/http/order-messaging-routes";
type Context = { params: Promise<{ "order-id": string }> };
export const GET = async (request: Request, context: Context) =>
  getMessages(request, "CUSTOMER", (await context.params)["order-id"]);
export const POST = async (request: Request, context: Context) =>
  sendMessage(request, "CUSTOMER", (await context.params)["order-id"]);
export const PATCH = async (request: Request, context: Context) =>
  markRead(request, "CUSTOMER", (await context.params)["order-id"]);

import type {
  AuthenticatedRequest,
  ListOrderMessagesRequest,
  MarkOrderConversationReadRequest,
  ReadOrderMessageAttachmentRequest,
  SaveOrderAcknowledgementRequest,
  SendOrderMessageRequest,
  StageOrderMessageAttachmentRequest,
} from "@freshmarkets/contracts";
import { idempotencyKeySchema, identifierSchema, z } from "@freshmarkets/validation";
import {
  getOrderAcknowledgement,
  saveOrderAcknowledgement,
} from "../messages/application/order-acknowledgement";
import {
  readOrderMessageAttachment,
  stageOrderMessageAttachment,
} from "../messages/application/order-message-attachments";
import { markOrderConversationRead } from "../messages/application/mark-order-conversation-read";
import {
  getOrderMessages,
  listOrderConversations,
} from "../messages/application/read-order-messages";
import { sendOrderMessage } from "../messages/application/send-order-message";
import { authenticatedRequestSchema } from "../validation";
import type { CoreRpcContext } from "./context";
import { validationFailure } from "./validation-errors";

const listSchema = authenticatedRequestSchema.extend({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const threadSchema = authenticatedRequestSchema.extend({
  orderId: identifierSchema,
  beforeSequence: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const sendSchema = authenticatedRequestSchema.extend({
  orderId: identifierSchema,
  body: z.string().max(2000),
  attachmentIds: z.array(identifierSchema).max(3),
  idempotencyKey: idempotencyKeySchema,
});
const readSchema = authenticatedRequestSchema.extend({
  orderId: identifierSchema,
  throughSequence: z.number().int().min(0),
});
const stageSchema = authenticatedRequestSchema.extend({
  orderId: identifierSchema,
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
  mimeType: z.string().min(1).max(100),
  fileName: z.string().min(1).max(255),
  idempotencyKey: idempotencyKeySchema,
});
const attachmentSchema = authenticatedRequestSchema.extend({
  orderId: identifierSchema,
  attachmentId: identifierSchema,
});
const acknowledgementSchema = authenticatedRequestSchema.extend({
  text: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
});

export function createMessagesRpc(context: CoreRpcContext, publish: () => void) {
  return {
    async listCustomerOrderConversations(
      input: AuthenticatedRequest & { cursor?: string; limit?: number },
    ) {
      const parsed = listSchema.safeParse(input);
      return parsed.success
        ? listOrderConversations(context, parsed.data, "CUSTOMER")
        : validationFailure(input.requestId, parsed.error);
    },
    async listAdminOrderConversations(
      input: AuthenticatedRequest & { cursor?: string; limit?: number },
    ) {
      const parsed = listSchema.safeParse(input);
      return parsed.success
        ? listOrderConversations(context, parsed.data, "ADMIN")
        : validationFailure(input.requestId, parsed.error);
    },
    async getCustomerOrderMessages(input: ListOrderMessagesRequest) {
      const parsed = threadSchema.safeParse(input);
      return parsed.success
        ? getOrderMessages(context, parsed.data, "CUSTOMER")
        : validationFailure(input.requestId, parsed.error);
    },
    async getAdminOrderMessages(input: ListOrderMessagesRequest) {
      const parsed = threadSchema.safeParse(input);
      return parsed.success
        ? getOrderMessages(context, parsed.data, "ADMIN")
        : validationFailure(input.requestId, parsed.error);
    },
    async sendCustomerOrderMessage(input: SendOrderMessageRequest) {
      const parsed = sendSchema.safeParse(input);
      if (!parsed.success) return validationFailure(input.requestId, parsed.error);
      const result = await sendOrderMessage(context, parsed.data, "CUSTOMER");
      if (result.ok) publish();
      return result;
    },
    async sendAdminOrderMessage(input: SendOrderMessageRequest) {
      const parsed = sendSchema.safeParse(input);
      if (!parsed.success) return validationFailure(input.requestId, parsed.error);
      const result = await sendOrderMessage(context, parsed.data, "ADMIN");
      if (result.ok) publish();
      return result;
    },
    async markCustomerOrderConversationRead(input: MarkOrderConversationReadRequest) {
      const parsed = readSchema.safeParse(input);
      return parsed.success
        ? markOrderConversationRead(context, parsed.data, "CUSTOMER")
        : validationFailure(input.requestId, parsed.error);
    },
    async markAdminOrderConversationRead(input: MarkOrderConversationReadRequest) {
      const parsed = readSchema.safeParse(input);
      return parsed.success
        ? markOrderConversationRead(context, parsed.data, "ADMIN")
        : validationFailure(input.requestId, parsed.error);
    },
    async stageCustomerOrderMessageAttachment(input: StageOrderMessageAttachmentRequest) {
      const parsed = stageSchema.safeParse(input);
      return parsed.success
        ? stageOrderMessageAttachment(context, parsed.data, "CUSTOMER")
        : validationFailure(input.requestId, parsed.error);
    },
    async stageAdminOrderMessageAttachment(input: StageOrderMessageAttachmentRequest) {
      const parsed = stageSchema.safeParse(input);
      return parsed.success
        ? stageOrderMessageAttachment(context, parsed.data, "ADMIN")
        : validationFailure(input.requestId, parsed.error);
    },
    async readCustomerOrderMessageAttachment(input: ReadOrderMessageAttachmentRequest) {
      const parsed = attachmentSchema.safeParse(input);
      return parsed.success
        ? readOrderMessageAttachment(context, parsed.data, "CUSTOMER")
        : validationFailure(input.requestId, parsed.error);
    },
    async readAdminOrderMessageAttachment(input: ReadOrderMessageAttachmentRequest) {
      const parsed = attachmentSchema.safeParse(input);
      return parsed.success
        ? readOrderMessageAttachment(context, parsed.data, "ADMIN")
        : validationFailure(input.requestId, parsed.error);
    },
    async getOrderAcknowledgement(input: AuthenticatedRequest) {
      const parsed = authenticatedRequestSchema.safeParse(input);
      return parsed.success
        ? getOrderAcknowledgement(context, parsed.data)
        : validationFailure(input.requestId, parsed.error);
    },
    async saveOrderAcknowledgement(input: SaveOrderAcknowledgementRequest) {
      const parsed = acknowledgementSchema.safeParse(input);
      return parsed.success
        ? saveOrderAcknowledgement(context, parsed.data)
        : validationFailure(input.requestId, parsed.error);
    },
  };
}

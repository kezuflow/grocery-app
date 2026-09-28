import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export const orderMessageImageMaxInputBytes = 18_000_000;
export const orderMessageImageMaxStoredBytes = 5 * 1024 * 1024;

export type OrderMessageAttachmentView = Readonly<{
  id: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  byteSize: number;
}>;

export type OrderMessageView = Readonly<{
  id: string;
  orderId: string;
  sequence: number;
  senderKind: "CUSTOMER" | "ADMIN" | "AUTOMATION";
  body: string;
  attachments: readonly OrderMessageAttachmentView[];
  createdAt: string;
}>;

export type OrderConversationView = Readonly<{
  orderId: string;
  orderNumber: string | null;
  latestMessageAt: string | null;
  latestMessagePreview: string | null;
  unreadCount: number;
  lastSequence: number;
  expiresAt: string | null;
}>;

export type OrderConversationsPage = Readonly<{
  items: readonly OrderConversationView[];
  nextCursor: string | null;
}>;

export type OrderMessagesPage = Readonly<{
  conversation: OrderConversationView;
  items: readonly OrderMessageView[];
  nextBeforeSequence: number | null;
}>;

export type ListOrderMessagesRequest = AuthenticatedRequest & {
  orderId: string;
  beforeSequence?: number;
  limit?: number;
};

export type SendOrderMessageRequest = AuthenticatedRequest & {
  orderId: string;
  body: string;
  attachmentIds: readonly string[];
  idempotencyKey: string;
};

export type SendOrderMessageView = Readonly<{
  messageId: string;
  sequence: number;
  acknowledgementMessageId: string | null;
}>;

export type StageOrderMessageAttachmentRequest = AuthenticatedRequest & {
  orderId: string;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  idempotencyKey: string;
};

export type CancelOrderMessageAttachmentRequest = AuthenticatedRequest & {
  orderId: string;
  idempotencyKey: string;
};

export type ReadOrderMessageAttachmentRequest = AuthenticatedRequest & {
  orderId: string;
  attachmentId: string;
};

export type OrderMessageAttachmentContent = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}>;

export type MarkOrderConversationReadRequest = AuthenticatedRequest & {
  orderId: string;
  throughSequence: number;
};

export type SaveOrderAcknowledgementRequest = AuthenticatedRequest & {
  text: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type OrderAcknowledgementView = Readonly<{ text: string; version: number }>;

export interface OrderMessagingService {
  listCustomerOrderConversations(
    request: AuthenticatedRequest & { cursor?: string; limit?: number },
  ): Promise<RpcResult<OrderConversationsPage>>;
  listAdminOrderConversations(
    request: AuthenticatedRequest & { cursor?: string; limit?: number; locationId?: string },
  ): Promise<RpcResult<OrderConversationsPage>>;
  getCustomerOrderMessages(
    request: ListOrderMessagesRequest,
  ): Promise<RpcResult<OrderMessagesPage>>;
  getAdminOrderMessages(request: ListOrderMessagesRequest): Promise<RpcResult<OrderMessagesPage>>;
  sendCustomerOrderMessage(
    request: SendOrderMessageRequest,
  ): Promise<RpcResult<SendOrderMessageView>>;
  sendAdminOrderMessage(request: SendOrderMessageRequest): Promise<RpcResult<SendOrderMessageView>>;
  markCustomerOrderConversationRead(
    request: MarkOrderConversationReadRequest,
  ): Promise<RpcResult<{ throughSequence: number }>>;
  markAdminOrderConversationRead(
    request: MarkOrderConversationReadRequest,
  ): Promise<RpcResult<{ throughSequence: number }>>;
  stageCustomerOrderMessageAttachment(
    request: StageOrderMessageAttachmentRequest,
  ): Promise<RpcResult<OrderMessageAttachmentView>>;
  stageAdminOrderMessageAttachment(
    request: StageOrderMessageAttachmentRequest,
  ): Promise<RpcResult<OrderMessageAttachmentView>>;
  cancelCustomerOrderMessageAttachment(
    request: CancelOrderMessageAttachmentRequest,
  ): Promise<RpcResult<{ canceled: true }>>;
  cancelAdminOrderMessageAttachment(
    request: CancelOrderMessageAttachmentRequest,
  ): Promise<RpcResult<{ canceled: true }>>;
  readCustomerOrderMessageAttachment(
    request: ReadOrderMessageAttachmentRequest,
  ): Promise<RpcResult<OrderMessageAttachmentContent>>;
  readAdminOrderMessageAttachment(
    request: ReadOrderMessageAttachmentRequest,
  ): Promise<RpcResult<OrderMessageAttachmentContent>>;
  getOrderAcknowledgement(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<OrderAcknowledgementView>>;
  saveOrderAcknowledgement(
    request: SaveOrderAcknowledgementRequest,
  ): Promise<RpcResult<OrderAcknowledgementView>>;
}

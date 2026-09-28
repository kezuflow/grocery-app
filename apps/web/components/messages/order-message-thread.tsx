"use client";

import { useRef } from "react";
import {
  Bell,
  BellOff,
  Bot,
  FileText,
  Headset,
  Paperclip,
  RefreshCw,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@/components/ui/message-scroller";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Attachment,
  AttachmentActions,
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { cn } from "@/lib/utils";
import { useOrderThread } from "./use-order-thread";

type Props = { side: "CUSTOMER" | "ADMIN"; orderId: string; canSend?: boolean; compact?: boolean };

export function OrderMessageThread({ side, orderId, canSend = true, compact = false }: Props) {
  const chat = useOrderThread(side, orderId);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = side === "ADMIN" ? "/api/admin/messages" : "/api/commerce/messages";
  const other = side === "CUSTOMER" ? "FreshMarkets team" : "Customer";
  const items = chat.page?.items ?? [];

  return (
    <Card
      className={cn(
        "fm-order-messages min-w-0",
        compact && "h-full gap-2 border-0 py-2 shadow-none",
      )}
    >
      <CardHeader
        className={cn(
          "flex flex-row flex-wrap items-start justify-between gap-3",
          compact && "px-3",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--fm-success-soft)] text-[var(--fm-storefront-accent)]">
            {side === "CUSTOMER" ? (
              <img
                src="/images/freshmarkets-support-avatar.webp"
                alt=""
                width={40}
                height={40}
                className="size-full rounded-full object-cover"
              />
            ) : (
              <UserRound className="size-5" aria-hidden="true" />
            )}
            <span
              role="status"
              aria-label={`${other} ${chat.connected && chat.otherPresent ? "available" : "unavailable"}${chat.connected ? "" : "; live updates reconnecting"}`}
              className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-[var(--fm-card)] ${chat.connected && chat.otherPresent ? "bg-[var(--fm-storefront-accent)]" : "bg-[#9ca3af]"}`}
            />
          </span>
          <CardTitle>
            {compact ? (
              <h2>Order {chat.page?.conversation.orderNumber ?? orderId}</h2>
            ) : (
              <h1>Order {chat.page?.conversation.orderNumber ?? orderId}</h1>
            )}
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={chat.muted ? "Turn notification sound on" : "Mute notification sound"}
            onClick={chat.toggleMute}
          >
            {chat.muted ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Refresh messages"
            onClick={() => void chat.refresh()}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "flex min-h-0 flex-col gap-4",
          compact && "flex-1 gap-2 overflow-y-auto px-3",
        )}
      >
        {chat.error ? (
          <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
            {chat.error}{" "}
            <Button type="button" variant="link" onClick={() => void chat.refresh()}>
              Retry
            </Button>
          </div>
        ) : null}
        <div
          className={cn(
            "h-[min(55vh,32rem)] min-h-64 rounded-lg border border-border bg-card",
            compact && "h-auto min-h-32 flex-1",
          )}
        >
          <MessageScrollerProvider autoScroll>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent className="gap-2 p-3 sm:p-4">
                  {chat.page?.nextBeforeSequence ? (
                    <MessageScrollerItem messageId="load-older">
                      <div className="flex justify-center">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void chat.loadOlder()}
                        >
                          Load older messages
                        </Button>
                      </div>
                    </MessageScrollerItem>
                  ) : null}
                  {chat.loading ? (
                    <MessageScrollerItem messageId="loading">
                      <Marker>
                        <MarkerContent>Loading messages…</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
                  {!chat.loading && items.length === 0 ? (
                    <MessageScrollerItem messageId="empty">
                      <Marker>
                        <MarkerContent>No messages yet. Start the conversation here.</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
                  {items.map((item) => {
                    const own = item.senderKind === side;
                    const automatic = item.senderKind === "AUTOMATION";
                    const sender = automatic
                      ? "FreshMarkets automatic reply"
                      : item.senderKind === "ADMIN"
                        ? "freshmarkets staff"
                        : "Customer";
                    return (
                      <MessageScrollerItem key={item.id} messageId={item.id} scrollAnchor={own}>
                        <Message align={own ? "end" : "start"}>
                          <MessageAvatar
                            role="img"
                            aria-label={sender}
                            data-sender-kind={item.senderKind}
                            className="size-8 border border-[var(--fm-success-border)] bg-[var(--fm-success-soft)] text-[var(--fm-storefront-accent)]"
                          >
                            {automatic ? (
                              <Bot className="size-4" aria-hidden="true" />
                            ) : item.senderKind === "ADMIN" ? (
                              <Headset className="size-4" aria-hidden="true" />
                            ) : (
                              <UserRound className="size-4" aria-hidden="true" />
                            )}
                          </MessageAvatar>
                          <MessageContent className="gap-1">
                            {own ? null : <MessageHeader>{sender}</MessageHeader>}
                            <Bubble
                              variant={own ? "default" : "secondary"}
                              align={own ? "end" : "start"}
                            >
                              <BubbleContent className="whitespace-pre-wrap">
                                {item.body || "Attachment"}
                              </BubbleContent>
                            </Bubble>
                            {item.attachments.length ? (
                              <AttachmentGroup>
                                {item.attachments.map((attachment) => {
                                  const href = `${base}/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(attachment.id)}`;
                                  const image = attachment.mimeType.startsWith("image/");
                                  return (
                                    <Attachment key={attachment.id} size="sm">
                                      <AttachmentMedia variant={image ? "image" : "icon"}>
                                        {image ? (
                                          <img src={href} alt="" />
                                        ) : (
                                          <FileText aria-hidden="true" />
                                        )}
                                      </AttachmentMedia>
                                      <AttachmentContent>
                                        <AttachmentTitle>{attachment.fileName}</AttachmentTitle>
                                        <AttachmentDescription>
                                          {Math.ceil(attachment.byteSize / 1024)} KB
                                        </AttachmentDescription>
                                      </AttachmentContent>
                                      <AttachmentActions>
                                        <AttachmentAction
                                          asChild
                                          aria-label={`Open ${attachment.fileName}`}
                                        >
                                          <a href={href} target="_blank" rel="noopener noreferrer">
                                            Open
                                          </a>
                                        </AttachmentAction>
                                      </AttachmentActions>
                                    </Attachment>
                                  );
                                })}
                              </AttachmentGroup>
                            ) : null}
                            <MessageFooter>
                              <time dateTime={item.createdAt}>
                                {new Intl.DateTimeFormat("en-PH", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                }).format(new Date(item.createdAt))}
                              </time>
                            </MessageFooter>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    );
                  })}
                  {chat.otherTyping ? (
                    <MessageScrollerItem messageId="typing">
                      <Marker>
                        <MarkerContent>{other} is typing…</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        </div>
        {canSend ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`message-${orderId}`}>Message</FieldLabel>
              <Textarea
                id={`message-${orderId}`}
                maxLength={2000}
                rows={3}
                value={chat.body}
                onChange={(event) => chat.updateBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (!event.repeat) void chat.send();
                  }
                }}
                onBlur={chat.stopTyping}
                placeholder="Write a message about this Order"
              />
            </Field>
            {chat.attachments.length ? (
              <AttachmentGroup>
                {chat.attachments.map((entry) => (
                  <Attachment
                    key={entry.key}
                    state={
                      entry.status === "preparing" || entry.status === "uploading"
                        ? "uploading"
                        : entry.status === "error"
                          ? "error"
                          : "done"
                    }
                    size="sm"
                  >
                    <AttachmentMedia variant="icon">
                      <Paperclip aria-hidden="true" />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{entry.file.name}</AttachmentTitle>
                      <AttachmentDescription>
                        {entry.error ??
                          (entry.status === "preparing"
                            ? "Preparing photo…"
                            : entry.status === "uploading"
                              ? "Uploading…"
                              : "Ready")}
                      </AttachmentDescription>
                    </AttachmentContent>
                    <AttachmentActions>
                      {entry.status === "error" ? (
                        <AttachmentAction
                          type="button"
                          onClick={() => chat.retryAttachment(entry.key)}
                        >
                          Retry
                        </AttachmentAction>
                      ) : null}
                      <AttachmentAction
                        type="button"
                        aria-label={`Remove ${entry.file.name}`}
                        onClick={() => chat.removeAttachment(entry.key)}
                      >
                        <X aria-hidden="true" />
                      </AttachmentAction>
                    </AttachmentActions>
                  </Attachment>
                ))}
              </AttachmentGroup>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                multiple
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                aria-label="Attach images"
                onChange={(event) => {
                  if (event.currentTarget.files) chat.addFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={chat.attachments.length >= 3}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip aria-hidden="true" /> Attach photos
                </Button>
                <span className="text-xs text-muted-foreground">Up to 3 photos, 18 MB each</span>
              </div>
              <Button
                type="button"
                disabled={
                  chat.sending ||
                  chat.attachments.some((item) => item.status !== "done") ||
                  (!chat.body.trim() && !chat.attachments.length)
                }
                onClick={() => void chat.send()}
              >
                <Send aria-hidden="true" /> {chat.sending ? "Sending…" : "Send message"}
              </Button>
            </div>
          </FieldGroup>
        ) : (
          <p className="text-sm text-muted-foreground">You can read this conversation.</p>
        )}
      </CardContent>
    </Card>
  );
}

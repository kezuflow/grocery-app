"use client";

import { useRef } from "react";
import { Bell, BellOff, FileText, Paperclip, RefreshCw, Send, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { useOrderThread } from "./use-order-thread";

type Props = { side: "CUSTOMER" | "ADMIN"; orderId: string; canSend?: boolean };

export function OrderMessageThread({ side, orderId, canSend = true }: Props) {
  const chat = useOrderThread(side, orderId);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = side === "ADMIN" ? "/api/admin/messages" : "/api/commerce/messages";
  const other = side === "CUSTOMER" ? "FreshMarkets team" : "Customer";
  const items = chat.page?.items ?? [];

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>
            <h1>Order messages</h1>
          </CardTitle>
          <CardDescription>Private conversation about this Order.</CardDescription>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {chat.connected
              ? chat.otherPresent
                ? `${other} is in this chat`
                : `${other} is not in this chat`
              : "Live updates are reconnecting"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>Order {chat.page?.conversation.orderNumber ?? orderId}</Badge>
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
      <CardContent className="flex min-h-0 flex-col gap-4">
        {chat.error ? (
          <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
            {chat.error}{" "}
            <Button type="button" variant="link" onClick={() => void chat.refresh()}>
              Retry
            </Button>
          </div>
        ) : null}
        <div className="h-[min(55vh,32rem)] min-h-64 rounded-lg border border-border bg-card">
          <MessageScrollerProvider autoScroll>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent className="gap-4 p-4">
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
                    const sender = own ? "You" : automatic ? "FreshMarkets automatic reply" : other;
                    return (
                      <MessageScrollerItem key={item.id} messageId={item.id} scrollAnchor={own}>
                        <Message align={own ? "end" : "start"}>
                          <MessageAvatar aria-hidden="true">{own ? "You" : "FM"}</MessageAvatar>
                          <MessageContent>
                            <MessageHeader>{sender}</MessageHeader>
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
        <p className="text-xs text-muted-foreground">
          Messages and attachments expire 14 days after the later of the last message and Order
          closure. Unresolved issues, refunds, disputes or a legal hold can delay deletion. Recovery
          backups may retain an older copy temporarily after live content is removed.
        </p>
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
                onBlur={chat.stopTyping}
                placeholder="Write a message about this Order"
              />
              <FieldDescription>
                Up to 2,000 characters and three private images or PDFs.
              </FieldDescription>
            </Field>
            {chat.attachments.length ? (
              <AttachmentGroup>
                {chat.attachments.map((entry) => (
                  <Attachment
                    key={entry.key}
                    state={
                      entry.status === "uploading"
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
                        {entry.error ?? (entry.status === "uploading" ? "Uploading…" : "Ready")}
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
                accept="image/jpeg,image/png,image/webp,application/pdf"
                aria-label="Attach images or PDFs"
                onChange={(event) => {
                  if (event.currentTarget.files) chat.addFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={chat.attachments.length >= 3}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip aria-hidden="true" /> Attach files
              </Button>
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

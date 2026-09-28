"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderMessagesPage, RpcResult } from "@freshmarkets/contracts";
import {
  notificationSoundMuted,
  playInAppNotificationSound,
  setNotificationSoundMuted,
} from "@/lib/notifications/in-app-sound";
import { prepareMessageImage } from "./prepare-message-image";

type Side = "CUSTOMER" | "ADMIN";
export type DraftAttachment = {
  key: string;
  file: File;
  uploadFile: File | null;
  id: string | null;
  status: "preparing" | "uploading" | "done" | "error";
  error: string | null;
};

function errorMessage(result: RpcResult<unknown>): string {
  return result.ok ? "" : result.error.message;
}

export function useOrderThread(side: Side, orderId: string) {
  const base = side === "ADMIN" ? "/api/admin/messages" : "/api/commerce/messages";
  const [page, setPage] = useState<OrderMessagesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [otherPresent, setOtherPresent] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [muted, setMuted] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const initialized = useRef(false);
  const known = useRef(new Set<string>());
  const sendKey = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const typingAt = useRef(0);

  useEffect(() => setMuted(notificationSoundMuted()), []);

  const refresh = useCallback(
    async (initial = false) => {
      try {
        const response = await fetch(`${base}/${encodeURIComponent(orderId)}`, {
          cache: "no-store",
        });
        const result = (await response.json()) as RpcResult<OrderMessagesPage>;
        if (!result.ok) throw new Error(errorMessage(result));
        if (!initial && initialized.current) {
          const incoming = result.value.items.filter(
            (item) => !known.current.has(item.id) && item.senderKind !== side,
          );
          if (incoming.length) void playInAppNotificationSound(`message:${incoming.at(-1)?.id}`);
        }
        for (const item of result.value.items) known.current.add(item.id);
        initialized.current = true;
        setPage(result.value);
        setError(null);
        if (result.value.conversation.lastSequence > 0)
          void fetch(`${base}/${encodeURIComponent(orderId)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ throughSequence: result.value.conversation.lastSequence }),
          });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Messages are unavailable");
      } finally {
        setLoading(false);
      }
    },
    [base, orderId, side],
  );

  useEffect(() => {
    initialized.current = false;
    known.current = new Set();
    setLoading(true);
    setPage(null);
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    let stopped = false;
    let reconnect: number | undefined;
    let heartbeat: number | undefined;
    let fallback: number | undefined;
    let delay = 1000;
    const close = () => {
      if (heartbeat) window.clearInterval(heartbeat);
      socket.current?.close();
      socket.current = null;
      setConnected(false);
      setOtherPresent(false);
      setOtherTyping(false);
    };
    const open = () => {
      if (stopped || document.visibilityState !== "visible" || socket.current) return;
      const url = new URL(`${base}/stream`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("orderId", orderId);
      const next = new WebSocket(url);
      socket.current = next;
      next.onopen = () => {
        delay = 1000;
        setConnected(true);
        void refresh();
        next.send(JSON.stringify({ type: "heartbeat" }));
        heartbeat = window.setInterval(() => {
          if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ type: "heartbeat" }));
        }, 60_000);
      };
      next.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as {
            type?: string;
            role?: Side;
            active?: boolean;
            until?: number;
            present?: { CUSTOMER?: boolean; ADMIN?: boolean };
          };
          if (data.type === "revision") void refresh();
          if (data.type === "presence")
            setOtherPresent(
              Boolean(side === "CUSTOMER" ? data.present?.ADMIN : data.present?.CUSTOMER),
            );
          if (data.type === "typing" && data.role !== side) {
            setOtherTyping(Boolean(data.active));
            if (data.active) window.setTimeout(() => setOtherTyping(false), 5_100);
          }
        } catch {
          /* Ignore malformed ephemeral hints. */
        }
      };
      next.onclose = () => {
        if (heartbeat) window.clearInterval(heartbeat);
        if (socket.current === next) socket.current = null;
        setConnected(false);
        setOtherPresent(false);
        setOtherTyping(false);
        if (!stopped && document.visibilityState === "visible") {
          reconnect = window.setTimeout(open, delay);
          delay = Math.min(delay * 2, 30_000);
        }
      };
      next.onerror = () => next.close();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        open();
      } else close();
    };
    document.addEventListener("visibilitychange", visibility);
    open();
    fallback = window.setInterval(() => {
      if (document.visibilityState === "visible" && !socket.current) void refresh();
    }, 60_000);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", visibility);
      if (reconnect) window.clearTimeout(reconnect);
      if (fallback) window.clearInterval(fallback);
      close();
    };
  }, [base, orderId, refresh, side]);

  const loadOlder = useCallback(async () => {
    if (!page?.nextBeforeSequence) return;
    try {
      const response = await fetch(
        `${base}/${encodeURIComponent(orderId)}?beforeSequence=${page.nextBeforeSequence}`,
        {
          cache: "no-store",
        },
      );
      const result = (await response.json()) as RpcResult<OrderMessagesPage>;
      if (!result.ok) throw new Error(errorMessage(result));
      setPage((current) =>
        current
          ? {
              ...current,
              items: [...result.value.items, ...current.items],
              nextBeforeSequence: result.value.nextBeforeSequence,
            }
          : result.value,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Older messages are unavailable");
    }
  }, [base, orderId, page?.nextBeforeSequence]);

  const updateBody = (value: string) => {
    setBody(value);
    sendKey.current = null;
    const now = Date.now();
    if (now - typingAt.current > 2500 && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: "typing", active: value.length > 0 }));
      typingAt.current = now;
    }
  };

  const upload = async (entry: DraftAttachment) => {
    if (!entry.uploadFile) return;
    const form = new FormData();
    form.set("file", entry.uploadFile);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(orderId)}/attachments`, {
        method: "POST",
        headers: { "idempotency-key": entry.key },
        body: form,
      });
      if (response.status === 413) throw new Error("Photo exceeds the 18 MB upload limit");
      const result = (await response.json()) as RpcResult<{ id: string }>;
      if (!result.ok) throw new Error(errorMessage(result));
      setAttachments((current) =>
        current.map((item) =>
          item.key === entry.key
            ? { ...item, id: result.value.id, status: "done", error: null }
            : item,
        ),
      );
    } catch (reason) {
      setAttachments((current) =>
        current.map((item) =>
          item.key === entry.key
            ? {
                ...item,
                status: "error",
                error: reason instanceof Error ? reason.message : "Upload failed",
              }
            : item,
        ),
      );
    }
  };

  const prepareAndUpload = async (entry: DraftAttachment) => {
    try {
      const uploadFile = await prepareMessageImage(entry.file);
      const prepared = { ...entry, uploadFile, status: "uploading" as const };
      setAttachments((current) =>
        current.map((item) => (item.key === entry.key ? prepared : item)),
      );
      await upload(prepared);
    } catch (reason) {
      setAttachments((current) =>
        current.map((item) =>
          item.key === entry.key
            ? {
                ...item,
                status: "error",
                error: reason instanceof Error ? reason.message : "Photo preparation failed",
              }
            : item,
        ),
      );
    }
  };

  const addFiles = (files: FileList | File[]) => {
    const remaining = Math.max(0, 3 - attachments.length);
    for (const file of Array.from(files).slice(0, remaining)) {
      const entry: DraftAttachment = {
        key: crypto.randomUUID(),
        file,
        uploadFile: null,
        id: null,
        status: "preparing",
        error: null,
      };
      setAttachments((current) => [...current, entry]);
      void prepareAndUpload(entry);
    }
  };

  const send = async () => {
    if (
      sendingRef.current ||
      attachments.some((item) => item.status !== "done") ||
      (!body.trim() && attachments.length === 0)
    )
      return;
    sendingRef.current = true;
    setSending(true);
    const key = (sendKey.current ??= crypto.randomUUID());
    try {
      const response = await fetch(`${base}/${encodeURIComponent(orderId)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ body, attachmentIds: attachments.map((item) => item.id) }),
      });
      const result = (await response.json()) as RpcResult<unknown>;
      if (!result.ok) throw new Error(errorMessage(result));
      sendKey.current = null;
      setBody("");
      setAttachments([]);
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "typing", active: false }));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message could not be sent");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const toggleMute = () => {
    setMuted((current) => {
      setNotificationSoundMuted(!current);
      return !current;
    });
  };

  return {
    page,
    loading,
    error,
    body,
    updateBody,
    attachments,
    addFiles,
    removeAttachment: (key: string) => {
      setAttachments((current) => current.filter((item) => item.key !== key));
      sendKey.current = null;
    },
    retryAttachment: (key: string) => {
      const entry = attachments.find((item) => item.key === key);
      if (entry) {
        setAttachments((current) =>
          current.map((item) =>
            item.key === key
              ? { ...item, status: entry.uploadFile ? "uploading" : "preparing", error: null }
              : item,
          ),
        );
        if (entry.uploadFile) void upload(entry);
        else void prepareAndUpload(entry);
      }
    },
    sending,
    connected,
    otherPresent,
    otherTyping,
    muted,
    toggleMute,
    send,
    refresh: () => refresh(),
    loadOlder,
    stopTyping: () => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "typing", active: false }));
    },
  };
}

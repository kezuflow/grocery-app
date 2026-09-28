"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderAcknowledgementView, RpcResult } from "@freshmarkets/contracts";
import { Button } from "@/components/admin/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/shadcn/card";
import { Field, FieldDescription, FieldLabel } from "@/components/admin/shadcn/field";
import { Textarea } from "@/components/admin/shadcn/textarea";

export function OrderAcknowledgementSettings() {
  const [saved, setSaved] = useState<OrderAcknowledgementView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/messages/acknowledgement", { cache: "no-store" })
      .then((response) => response.json() as Promise<RpcResult<OrderAcknowledgementView>>)
      .then((result) => {
        if (!active) return;
        if (!result.ok) throw new Error(result.error.message);
        setSaved(result.value);
        setText(result.value.text);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Setting unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (!saved || busy || text.trim() === saved.text) return;
    key.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/messages/acknowledgement", {
        method: "PATCH",
        cache: "no-store",
        headers: { "content-type": "application/json", "idempotency-key": key.current },
        body: JSON.stringify({ text: text.trim(), expectedVersion: saved.version }),
      });
      const result = (await response.json()) as RpcResult<OrderAcknowledgementView>;
      if (!result.ok) throw new Error(result.error.message);
      setSaved(result.value);
      setText(result.value.text);
      key.current = null;
      setNotice("Automatic reply saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the reply");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="fm-order-messages">
      <CardHeader>
        <CardTitle>
          <h2>Automatic reply</h2>
        </CardTitle>
        <CardDescription>Sent once when a customer first messages about an Order.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field>
          <FieldLabel htmlFor="order-acknowledgement">Acknowledgement</FieldLabel>
          <Textarea
            id="order-acknowledgement"
            value={text}
            maxLength={500}
            rows={3}
            onChange={(event) => {
              setText(event.target.value);
              key.current = null;
            }}
          />
          <FieldDescription>Up to 500 characters.</FieldDescription>
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
        <Button
          type="button"
          disabled={!saved || busy || !text.trim() || text.trim() === saved.text}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save reply"}
        </Button>
      </CardContent>
    </Card>
  );
}

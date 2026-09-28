"use client";

import { useAdminContext } from "../admin-context-provider";
import { OrderMessagesInbox } from "@/components/messages/order-messages-inbox";
import { OrderAcknowledgementSettings } from "@/components/messages/order-acknowledgement-settings";

export default function AdminMessagesPage() {
  const { state } = useAdminContext();
  const allowed =
    state.phase === "ready" &&
    state.selectedScope?.kind === "GLOBAL" &&
    state.context.capabilities.includes("orders.read");
  const canManage = allowed && state.context.capabilities.includes("orders.manage");
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Order messages</h1>
        <p className="text-sm text-muted-foreground">Customer conversations about Orders.</p>
      </header>
      {state.phase === "ready" && !allowed ? (
        <p role="alert">Select Global scope with Orders access to view messages.</p>
      ) : null}
      {allowed ? (
        <>
          <OrderMessagesInbox side="ADMIN" />
          {canManage ? <OrderAcknowledgementSettings /> : null}
        </>
      ) : null}
    </main>
  );
}

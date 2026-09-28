"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminContext } from "../../admin-context-provider";
import { OrderMessageThread } from "@/components/messages/order-message-thread";

export default function AdminMessageThreadPage() {
  const orderId = useParams<{ "order-id": string }>()?.["order-id"];
  const { state } = useAdminContext();
  const allowed =
    state.phase === "ready" &&
    state.selectedScope?.kind === "GLOBAL" &&
    state.context.capabilities.includes("orders.read");
  const canSend = allowed && state.context.capabilities.includes("orders.manage");
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Link href="/admin/messages" className="text-sm font-medium underline underline-offset-4">
        Back to messages
      </Link>
      {state.phase === "ready" && !allowed ? (
        <p role="alert">Select Global scope with Orders access to view messages.</p>
      ) : null}
      {allowed && orderId ? (
        <OrderMessageThread side="ADMIN" orderId={orderId} canSend={canSend} />
      ) : null}
    </main>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { OrderMessageThread } from "@/components/messages/order-message-thread";

export default function CustomerMessageThreadPage() {
  const orderId = useParams<{ "order-id": string }>()?.["order-id"];
  if (!orderId) return null;
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/account/messages" className="text-sm font-semibold underline underline-offset-4">
        Back to messages
      </Link>
      <div className="mt-6">
        <OrderMessageThread side="CUSTOMER" orderId={orderId} />
      </div>
    </main>
  );
}

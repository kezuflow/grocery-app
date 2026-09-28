import Link from "next/link";
import { OrderMessagesInbox } from "@/components/messages/order-messages-inbox";

export default function CustomerMessagesPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/account" className="text-sm font-semibold underline underline-offset-4">
        Back to account
      </Link>
      <div className="mt-6">
        <OrderMessagesInbox side="CUSTOMER" />
      </div>
    </main>
  );
}

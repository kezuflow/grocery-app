import type { CustomerOrderDetailView } from "@freshmarkets/contracts";

export function RefundClaimAction({
  refund,
}: {
  refund: CustomerOrderDetailView["refunds"][number];
}) {
  const action = refund.claimAction;
  if (refund.status !== "PROCESSING" || !action) return null;
  return (
    <div className="mt-3">
      <p className="text-sm">
        Your refund is ready to claim. Choose your bank or e-wallet in PayMongo to receive it.
      </p>
      <a
        href={action.url}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-[var(--fm-radius-control)] bg-red-700 px-5 py-2 text-sm font-bold text-white! hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700!"
      >
        Claim refund
      </a>
      <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
        Claim before{" "}
        {new Date(action.expiresAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}. Your
        refund remains processing until it is confirmed.
      </p>
    </div>
  );
}

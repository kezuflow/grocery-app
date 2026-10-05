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
        className="mt-2 inline-block font-semibold underline"
      >
        Claim refund
      </a>
      <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
        Claim before{" "}
        {new Date(action.expiresAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}. Your
        refund remains processing until it is confirmed.
      </p>
    </div>
  );
}

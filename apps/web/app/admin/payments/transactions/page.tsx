import { redirect } from "next/navigation";
export default async function PaymentTransactionsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const mapped =
    status === "SUCCEEDED"
      ? "paid"
      : status === "PARTIALLY_REFUNDED"
        ? "partially-refunded"
        : status === "REFUNDED"
          ? "refunded"
          : null;
  redirect(mapped ? `/admin/payments?status=${mapped}` : "/admin/payments");
}

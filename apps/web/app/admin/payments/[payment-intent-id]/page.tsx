import { redirect } from "next/navigation";
export default async function PaymentDetailRedirect({
  params,
}: {
  params: Promise<{ "payment-intent-id": string }>;
}) {
  const { "payment-intent-id": id } = await params;
  redirect(`/admin/payments?payment=${encodeURIComponent(id)}`);
}

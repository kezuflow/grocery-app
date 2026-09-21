import type {
  AdminPaymentAttentionPage,
  AdminPaymentDetail,
  AdminPaymentPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { PaymentsWorkspace } from "@/components/admin/payments-workspace";

type Params = { tab?: string; status?: string; cursor?: string; payment?: string; issue?: string };
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const requestHeaders = coreRequestHeaders(await headers());
  const tab = params.tab === "attention" ? "attention" : "payments";
  const status =
    params.status === "paid"
      ? "SUCCEEDED"
      : params.status === "partially-refunded"
        ? "PARTIALLY_REFUNDED"
        : params.status === "refunded"
          ? "REFUNDED"
          : undefined;
  const [payments, attention, detail] = await Promise.all([
    coreClient(env.CORE).listAdminPayments({
      requestId: crypto.randomUUID(),
      headers: requestHeaders,
      status,
      cursor: tab === "payments" ? params.cursor : undefined,
      limit: 50,
    }),
    coreClient(env.CORE).listAdminPaymentAttention({
      requestId: crypto.randomUUID(),
      headers: requestHeaders,
      cursor: tab === "attention" ? params.cursor : undefined,
      limit: 50,
    }),
    params.payment
      ? coreClient(env.CORE).getAdminPayment({
          requestId: crypto.randomUUID(),
          headers: requestHeaders,
          paymentIntentId: params.payment,
        })
      : Promise.resolve(null),
  ]);
  return (
    <PaymentsWorkspace
      initialTab={tab}
      initialStatus={params.status ?? "all"}
      initialPayments={plain(payments as RpcResult<AdminPaymentPage>)}
      initialAttention={plain(attention as RpcResult<AdminPaymentAttentionPage>)}
      initialDetail={plain(detail as RpcResult<AdminPaymentDetail> | null)}
      initialIssue={params.issue ?? null}
    />
  );
}

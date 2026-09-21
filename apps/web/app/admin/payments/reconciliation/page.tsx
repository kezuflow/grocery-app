import { redirect } from "next/navigation";
export default function PaymentReconciliationRedirect() {
  redirect("/admin/payments?tab=attention");
}

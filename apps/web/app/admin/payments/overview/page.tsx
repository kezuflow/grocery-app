import { redirect } from "next/navigation";
export default function PaymentsOverviewRedirect() {
  redirect("/admin/payments");
}

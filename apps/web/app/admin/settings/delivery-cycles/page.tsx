import { redirect } from "next/navigation";

export default async function DeliveryCyclesPage() {
  redirect("/admin/settings/scheduled-cycles");
}

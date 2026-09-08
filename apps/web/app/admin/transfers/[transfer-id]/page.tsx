"use client";
import { useParams } from "next/navigation";
import { InventoryTransferDetail } from "@/components/admin/inventory-transfers";
export default function TransferPage() {
  const params = useParams<{ "transfer-id": string }>();
  return <InventoryTransferDetail key={params["transfer-id"]} transferId={params["transfer-id"]} />;
}

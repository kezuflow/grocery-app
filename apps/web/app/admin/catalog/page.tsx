"use client";

import type { AdminUnitSummary, RpcResult } from "@freshmarkets/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/admin-shell";
import { AdminStatusPill } from "@/components/admin/admin-status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminContext } from "../admin-context-provider";

type UnitState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; units: AdminUnitSummary[] };

function conversion(unit: AdminUnitSummary): string {
  const ratio =
    unit.conversionDenominator === 1
      ? unit.conversionNumerator.toLocaleString()
      : `${unit.conversionNumerator.toLocaleString()}/${unit.conversionDenominator.toLocaleString()}`;
  return `1 ${unit.code} = ${ratio} ${unit.canonicalBaseCode}`;
}

export default function CatalogPage() {
  const admin = useAdminContext();
  const [state, setState] = useState<UnitState>({ phase: "loading" });
  const globalReader =
    admin.state.phase === "ready" &&
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("catalog.read");

  useEffect(() => {
    if (!globalReader) return;
    let current = true;
    setState({ phase: "loading" });
    void fetch("/api/admin/catalog/units")
      .then((response) => response.json() as Promise<RpcResult<AdminUnitSummary[]>>)
      .then((result) => {
        if (!current) return;
        setState(
          result.ok
            ? { phase: "ready", units: result.value }
            : {
                phase: "error",
                message: result.error.message,
                requestId: result.error.requestId,
              },
        );
      })
      .catch(() => {
        if (current)
          setState({
            phase: "error",
            message: "Network error loading controlled units. Reload to retry.",
            requestId: null,
          });
      });
    return () => {
      current = false;
    };
  }, [globalReader]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Catalog"
        description="Global Product and Category ownership with the controlled sell-unit reference."
      />
      {admin.state.phase !== "ready" ? (
        <div role="status" aria-label="Loading catalog">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : admin.state.selectedScope?.kind !== "GLOBAL" ? (
        <Alert variant="warning">
          <AlertTitle>Global catalog reference</AlertTitle>
          <AlertDescription>
            Select Global scope to see controlled units. Products at this fulfillment location
            remain available in the Product list.
          </AlertDescription>
        </Alert>
      ) : !admin.state.context.capabilities.includes("catalog.read") ? (
        <Alert variant="destructive">
          <AlertDescription>
            Catalog administration requires the catalog.read capability with a global scope.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5">
              <h2 className="text-base font-semibold">Products</h2>
              <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                Manage Global identity, selling options and lifecycle in the Product workspace.
                Exact prices and inventory belong to a selected fulfillment location.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-4">
                <Link href="/admin/catalog/products" prefetch={false}>
                  Open Products
                </Link>
              </Button>
            </section>
            <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5">
              <h2 className="text-base font-semibold">Categories</h2>
              <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                Maintain the existing catalog hierarchy and Product assignments in Categories.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-4">
                <Link href="/admin/catalog/categories" prefetch={false}>
                  Open Categories
                </Link>
              </Button>
            </section>
          </div>
          <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)]">
            <div className="border-b border-[var(--fm-border)] px-5 py-4">
              <h2 className="text-base font-semibold">Controlled units</h2>
              <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                Shared-weight variants consume one exact base-unit stock pool. Counted sizes use
                actual counted PIECE stock after counting. Shipping weight is a logistics reference,
                never a conversion from grams to pieces.
              </p>
            </div>
            {state.phase === "loading" ? (
              <div className="space-y-2 p-5" role="status" aria-label="Loading controlled units">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : state.phase === "error" ? (
              <Alert variant="destructive" className="m-4">
                <AlertTitle>Controlled units could not be loaded</AlertTitle>
                <AlertDescription>
                  {state.message}
                  {state.requestId ? ` Request reference: ${state.requestId}` : ""}
                </AlertDescription>
              </Alert>
            ) : state.units.length === 0 ? (
              <p role="status" className="p-5 text-sm text-[var(--fm-text-muted)]">
                No controlled units are defined.
              </p>
            ) : (
              <>
                <div className="divide-y divide-[var(--fm-border)] md:hidden">
                  {state.units.map((unit) => (
                    <article key={unit.unitId} className="space-y-2 p-4 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold">{unit.displayName}</h3>
                          <p className="text-xs text-[var(--fm-text-muted)]">{unit.code}</p>
                        </div>
                        <AdminStatusPill
                          status={unit.status}
                          label={unit.status === "active" ? "Active" : "Inactive"}
                        />
                      </div>
                      <p>
                        {unit.dimension} · {conversion(unit)}
                      </p>
                    </article>
                  ))}
                </div>
                <div className="hidden md:block">
                  <Table aria-label="Controlled units">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unit</TableHead>
                        <TableHead>Dimension</TableHead>
                        <TableHead>Exact base conversion</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.units.map((unit) => (
                        <TableRow key={unit.unitId}>
                          <TableCell>
                            <span className="font-medium">{unit.displayName}</span>
                            <span className="block text-xs text-[var(--fm-text-muted)]">
                              {unit.code}
                            </span>
                          </TableCell>
                          <TableCell>{unit.dimension}</TableCell>
                          <TableCell>{conversion(unit)}</TableCell>
                          <TableCell>
                            <AdminStatusPill
                              status={unit.status}
                              label={unit.status === "active" ? "Active" : "Inactive"}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

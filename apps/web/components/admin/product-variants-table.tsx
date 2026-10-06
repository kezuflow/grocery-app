"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import type { AdminCatalogSkuSummary, AdminProductDetail } from "@freshmarkets/contracts";
import {
  z,
  adminCatalogSkuSummarySchema,
  adminSkuOrderResultSchema,
} from "@freshmarkets/validation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "./shadcn/button";
import { Switch } from "./shadcn/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./shadcn/table";
import { Alert, AlertDescription, AlertTitle } from "./shadcn/alert";
import { StatusBadge } from "./admin-shell";
import { SkuVariantEditor } from "./sku-variant-editor";
import { useCatalogCommand } from "./catalog-command-state";
import { useAdminScopeGuard } from "../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "./use-admin-route-guard";

const resultSchema = z.union([adminCatalogSkuSummarySchema, adminSkuOrderResultSchema]);

function VariantRow({
  sku,
  position,
  sortable,
  disabled,
  children,
}: {
  sku: AdminCatalogSkuSummary;
  position: number;
  sortable: boolean;
  disabled: boolean;
  children: ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sku.skuId, disabled: !sortable || disabled });
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-state={isDragging ? "selected" : undefined}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          {sortable ? (
            <Button
              ref={setActivatorNodeRef}
              type="button"
              variant="ghost"
              size="icon"
              className="touch-none"
              disabled={disabled}
              aria-label={`Move ${sku.code}`}
              {...attributes}
              {...listeners}
            >
              <GripVertical />
            </Button>
          ) : null}
          <span aria-label={`Position ${position}`}>{position}</span>
        </div>
      </TableCell>
      {children}
    </TableRow>
  );
}

export function ProductVariantsTable({
  product,
  canManageGlobal,
  canManageLocation,
  disabled = false,
  onInteractionChange,
  onSaved,
}: {
  product: AdminProductDetail;
  canManageGlobal: boolean;
  canManageLocation: boolean;
  disabled?: boolean;
  onInteractionChange: (active: boolean) => void;
  onSaved: () => void;
}) {
  const id = useId();
  const command = useCatalogCommand(resultSchema, { retainConflict: true });
  const [rows, setRows] = useState(() => [...product.skus]);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const frozen = command.pending || command.uncertain;
  const blocked = disabled || frozen || editing;
  const local = product.scope.kind === "LOCATION";
  const sortable = !local && canManageGlobal && rows.length > 1;
  const counted = product.inventoryPool.stockTracking === "COUNTED_SIZES";
  const baseUnit = counted ? "PIECE" : product.inventoryPool.baseUnitCode;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useEffect(() => {
    onInteractionChange(frozen || editing || dragging);
    return () => onInteractionChange(false);
  }, [frozen, editing, dragging, onInteractionChange]);
  useAdminScopeGuard(false, frozen || dragging);
  useAdminRouteGuard(false, frozen || dragging);
  // Refreshes cannot replace an unresolved request or a reviewed variant edit.
  useEffect(() => {
    if (!frozen && !editing && !dragging) setRows([...product.skus]);
  }, [product.skus, frozen, editing, dragging]);

  async function save(
    url?: string,
    body?: unknown,
    method: "POST" | "PATCH" | "PUT" = "POST",
    title = "Variant order saved",
  ) {
    if (command.pending || disabled) return;
    setNotice(null);
    try {
      const result = url
        ? await command.submit(url, body, method, { title })
        : await command.retry();
      if (!result) return;
      if (!result.ok) {
        setNotice(result.error.message);
        return;
      }
      onSaved();
    } catch {
      setNotice("The change could not be confirmed. Retry the saved change to check its result.");
    }
  }
  function move({ active, over }: DragEndEvent) {
    setDragging(false);
    if (blocked || !sortable || !over || active.id === over.id) return;
    const ordered = arrayMove(
      rows,
      rows.findIndex((sku) => sku.skuId === active.id),
      rows.findIndex((sku) => sku.skuId === over.id),
    );
    void save(
      `/api/admin/catalog/products/${encodeURIComponent(product.productId)}/variants/order`,
      {
        expectedProductVersion: product.version,
        variants: ordered.map((sku) => ({ skuId: sku.skuId, expectedVersion: sku.version })),
      },
    );
  }
  function toggle(sku: AdminCatalogSkuSummary, checked: boolean) {
    if (blocked || (!local && !canManageGlobal) || (local && !canManageLocation)) return;
    if (product.scope.kind === "LOCATION") {
      void save(
        `/api/admin/catalog/skus/${encodeURIComponent(sku.skuId)}/availability`,
        {
          locationId: product.scope.locationId,
          availabilityStatus: checked ? "AVAILABLE" : "UNAVAILABLE",
          expectedVersion: sku.availabilityVersion ?? 0,
        },
        "PUT",
        "Selling status saved",
      );
    } else {
      void save(
        `/api/admin/catalog/skus/${encodeURIComponent(sku.skuId)}`,
        { status: checked ? "active" : "inactive", expectedVersion: sku.version },
        "PATCH",
        "Variant status saved",
      );
    }
  }
  function moveAnnouncement(activeId: UniqueIdentifier, overId?: UniqueIdentifier) {
    const sku = rows.find((row) => row.skuId === activeId);
    return `${sku?.code ?? "Variant"} at position ${rows.findIndex((row) => row.skuId === (overId ?? activeId)) + 1}.`;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="px-5 text-sm text-muted-foreground">
        {local
          ? `Selling switches apply only to ${product.scope.kind === "LOCATION" ? product.scope.locationName : "this location"}. Catalog status and stock remain separate.`
          : "Selling switches activate or stop a variant across all locations. Each location also controls its own selling availability."}{" "}
        {sortable
          ? "Drag a handle to change storefront order. With a keyboard, press Space, use arrow keys, then Space to save or Escape to cancel."
          : null}
      </p>
      {notice ? (
        <Alert variant="destructive" className="mx-5 w-auto">
          <AlertTitle>Variant change needs attention</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {frozen ? (
        <div role="status" className="flex items-center gap-3 px-5">
          <span>{command.pending ? "Saving variant change…" : "Result unconfirmed."}</span>
          {command.uncertain ? (
            <Button
              type="button"
              variant="outline"
              disabled={command.pending || disabled}
              onClick={() => void save()}
            >
              Retry saved variant change
            </Button>
          ) : null}
        </div>
      ) : notice ? (
        <div className="px-5">
          <Button type="button" variant="outline" onClick={onSaved} disabled={disabled}>
            Refresh variants
          </Button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No sell variants defined.</p>
      ) : (
        <DndContext
          id={id}
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => `Picked up ${moveAnnouncement(active.id)}`,
              onDragOver: ({ active, over }) =>
                over
                  ? `Moving ${moveAnnouncement(active.id, over.id)}`
                  : "Move within the variant list.",
              onDragEnd: ({ active, over }) =>
                over
                  ? `Dropped ${moveAnnouncement(active.id, over.id)}`
                  : "Variant order unchanged.",
              onDragCancel: () => "Variant move canceled. Order unchanged.",
            },
          }}
          onDragStart={() => setDragging(true)}
          onDragCancel={() => setDragging(false)}
          onDragEnd={move}
        >
          <Table aria-label="Sell variants">
            <TableHeader>
              <TableRow>
                <TableHead>Position</TableHead>
                <TableHead>SKU code</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead>Inventory consumed</TableHead>
                <TableHead>Shipping weight</TableHead>
                {local ? <TableHead>Catalog status</TableHead> : null}
                <TableHead>Selling</TableHead>
                {!local && canManageGlobal ? <TableHead>Actions</TableHead> : null}
                {local ? (
                  <>
                    <TableHead>Price</TableHead>
                    <TableHead>Stock status</TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              <SortableContext
                items={rows.map((sku) => sku.skuId)}
                strategy={verticalListSortingStrategy}
              >
                {rows.map((sku, index) => {
                  const selling = local
                    ? sku.availability === "AVAILABLE"
                    : sku.status === "active";
                  return (
                    <VariantRow
                      key={sku.skuId}
                      sku={sku}
                      position={index + 1}
                      sortable={sortable}
                      disabled={blocked}
                    >
                      <TableCell className="font-mono text-xs">{sku.code}</TableCell>
                      <TableCell>
                        {sku.name}
                        {sku.merchandisingLabel ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({sku.merchandisingLabel})
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {sku.consumptionBaseQuantity.toLocaleString()}{" "}
                        {counted ? "pieces/packs" : product.inventoryPool.baseUnitSymbol}
                      </TableCell>
                      <TableCell>
                        {baseUnit === "GRAM"
                          ? `${sku.consumptionBaseQuantity.toLocaleString()} g`
                          : sku.estimatedShippingWeightGrams === null
                            ? "Not configured"
                            : `${sku.estimatedShippingWeightGrams.toLocaleString()} g each`}
                      </TableCell>
                      {local ? (
                        <TableCell>
                          <StatusBadge tone={sku.status === "active" ? "success" : "neutral"}>
                            {sku.status === "active" ? "Active" : "Inactive"}
                          </StatusBadge>
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            aria-label={`Selling ${sku.code}`}
                            checked={selling}
                            disabled={blocked || (local ? !canManageLocation : !canManageGlobal)}
                            onCheckedChange={(checked) => toggle(sku, checked)}
                          />
                          <span>
                            {selling
                              ? "Selling"
                              : local && sku.availability === null
                                ? "Not configured"
                                : "Not selling"}
                          </span>
                        </div>
                      </TableCell>
                      {!local && canManageGlobal ? (
                        <TableCell>
                          <SkuVariantEditor
                            sku={sku}
                            baseUnitCode={baseUnit}
                            disabled={blocked || dragging}
                            onSaved={onSaved}
                            onInteractionChange={setEditing}
                          />
                        </TableCell>
                      ) : null}
                      {local ? (
                        <>
                          <TableCell className="text-xs">
                            {sku.priceMinor === null || !sku.currency
                              ? "—"
                              : `${new Intl.NumberFormat(undefined, { style: "currency", currency: sku.currency }).format(sku.priceMinor / 100)} (v${sku.priceVersion})`}
                          </TableCell>
                          <TableCell>
                            {product.inventoryPool.position ? (
                              <StatusBadge
                                tone={
                                  (sku.availableBase ??
                                    product.inventoryPool.position.availableBase) >=
                                  sku.consumptionBaseQuantity
                                    ? "success"
                                    : "neutral"
                                }
                              >
                                {(sku.availableBase ??
                                  product.inventoryPool.position.availableBase) >=
                                sku.consumptionBaseQuantity
                                  ? "In stock"
                                  : "Insufficient stock"}
                              </StatusBadge>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                No stock recorded
                              </span>
                            )}
                          </TableCell>
                        </>
                      ) : null}
                    </VariantRow>
                  );
                })}
              </SortableContext>
            </TableBody>
          </Table>
        </DndContext>
      )}
    </div>
  );
}

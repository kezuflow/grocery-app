"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  AdminCommerceMetric,
  AdminCommerceOverview,
  AdminOverviewView,
  AdminSelectedScope,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CreditCard,
  ShoppingBag,
  Users,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { AdminPageState } from "./admin-page-state";
import { Empty as EmptyState, EmptyHeader, EmptyDescription } from "./shadcn/empty";
import { Badge } from "./shadcn/badge";
import { Button } from "./shadcn/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./shadcn/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./shadcn/chart";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./shadcn/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./shadcn/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./shadcn/tabs";

export function AdminCommerceOverviewSection({
  scope,
  timezone,
  refreshKey,
  period,
  onPeriodChange,
}: {
  scope: AdminSelectedScope;
  timezone: string;
  refreshKey: string;
  period: AdminCommerceOverview["period"];
  onPeriodChange: (period: AdminCommerceOverview["period"]) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    result: RpcResult<AdminOverviewView>;
  } | null>(null);
  const key = JSON.stringify([scope, timezone, period, refreshKey, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ scopeKind: scope.kind, timezone, commercePeriod: period });
    if (scope.kind !== "GLOBAL") query.set("marketId", scope.marketId);
    if (scope.kind === "LOCATION") query.set("locationId", scope.locationId);
    void fetch(`/api/admin/overview?${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json() as Promise<RpcResult<AdminOverviewView>>)
      .then((result) => {
        if (!controller.signal.aborted) setLoaded({ key, result });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoaded({
            key,
            result: {
              ok: false,
              error: {
                code: "INTERNAL_ERROR",
                message: "We couldn’t load the commerce overview.",
                requestId: "unavailable",
              },
            },
          });
      });
    return () => controller.abort();
  }, [key, scope, timezone, period]);
  const result = loaded?.key === key ? loaded.result : null;
  return (
    <div className="fm-admin-commerce flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Business overview</h2>
          <p className="text-sm text-muted-foreground">Revenue, customers and what’s selling.</p>
        </div>
        <Select
          value={period}
          onValueChange={(value) => {
            if (value === "7d" || value === "30d" || value === "90d") onPeriodChange(value);
          }}
        >
          <SelectTrigger aria-label="Overview period" className="w-44">
            <CalendarDays aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {!result ? (
        <AdminPageState state="loading" />
      ) : !result.ok ? (
        <AdminPageState
          state="error"
          message={result.error.message}
          requestId={result.error.requestId}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : result.value.commerce ? (
        <AdminCommerceDashboard data={result.value.commerce} />
      ) : (
        <AdminPageState
          state="permission-empty"
          message="Analytics access is required to view business metrics."
        />
      )}
    </div>
  );
}

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100);
}
function number(value: number) {
  return value.toLocaleString("en-PH", { maximumFractionDigits: 1 });
}
function status(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}
function Change({
  metric,
  rate = false,
  lowerIsBetter = false,
}: {
  metric: AdminCommerceMetric;
  rate?: boolean;
  lowerIsBetter?: boolean;
}) {
  if (metric.value === null || metric.previousValue === null || (!metric.previousValue && !rate))
    return null;
  const change = rate
    ? metric.value - metric.previousValue
    : ((metric.value - metric.previousValue) / metric.previousValue) * 100;
  const Icon = change < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <Badge
      variant="outline"
      className="fm-commerce-change"
      data-tone={change === 0 ? "neutral" : change > 0 !== lowerIsBetter ? "positive" : "negative"}
      aria-label={`${change > 0 ? "+" : ""}${number(change)} ${rate ? "percentage points" : "percent"} compared with the previous period`}
    >
      <Icon aria-hidden />
      {change > 0 ? "+" : ""}
      {number(change)}
      {rate ? " pp" : "%"}
    </Badge>
  );
}
function Metric({
  title,
  metric,
  format = number,
  icon: Icon,
  rate,
  lowerIsBetter,
  sparkline,
}: {
  title: string;
  metric: AdminCommerceMetric;
  format?: (value: number) => string;
  icon: typeof Wallet;
  rate?: boolean;
  lowerIsBetter?: boolean;
  sparkline?: {
    label: string;
    points: { label: string; value: number | null }[];
    format: (value: number) => string;
    color: string;
  };
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </CardAction>
        <CardTitle className="col-span-2 flex flex-wrap items-center gap-2 text-2xl tabular-nums">
          <span title={metric.unavailableReason ?? undefined}>
            {metric.value === null ? "—" : format(metric.value)}
            {metric.value === null && metric.unavailableReason ? (
              <span className="sr-only">{metric.unavailableReason}</span>
            ) : null}
          </span>
          <Change metric={metric} rate={rate} lowerIsBetter={lowerIsBetter} />
        </CardTitle>
      </CardHeader>
      {sparkline &&
      metric.value !== null &&
      sparkline.points.some((point) => point.value !== null) ? (
        <CardContent className="mt-auto">
          <ChartContainer
            aria-label={sparkline.label}
            className="h-16 w-full"
            config={{ value: { label: sparkline.label, color: sparkline.color } }}
          >
            <LineChart
              accessibilityLayer
              data={sparkline.points}
              margin={{ top: 4, bottom: 4, left: 2, right: 2 }}
            >
              <XAxis dataKey="label" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => <span>{sparkline.format(Number(value))}</span>}
                  />
                }
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="value"
                stroke="var(--color-value)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      ) : null}
    </Card>
  );
}
function Empty({ message }: { message: string }) {
  return (
    <EmptyState>
      <EmptyHeader>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </EmptyState>
  );
}

export function AdminCommerceDashboard({ data }: { data: AdminCommerceOverview }) {
  const displayDate = (date: string) =>
    new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  const periodLabel = `${new Date(data.startAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: data.timezone })} – ${new Date(data.endAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: data.timezone })}`;
  let addedUsers: number | null = 0;
  const rows = data.series.map((point) => {
    addedUsers =
      addedUsers !== null && point.newUsers !== null ? addedUsers + point.newUsers : null;
    return {
      ...point,
      label: displayDate(point.date),
      received: point.receivedMinor === null ? null : point.receivedMinor / 100,
      refunded: point.refundedMinor === null ? null : point.refundedMinor / 100,
      userGrowth:
        addedUsers !== null &&
        data.users.previousValue !== null &&
        data.users.previousValue > 0 &&
        data.userGrowth.value !== null
          ? (addedUsers / data.users.previousValue) * 100
          : null,
      returningRate:
        point.customers && point.returningCustomers !== null
          ? (point.returningCustomers / point.customers) * 100
          : null,
    };
  });
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div aria-label="Commerce metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          title="Total revenue"
          metric={data.revenue}
          format={money}
          icon={Wallet}
          sparkline={
            data.deniedSections.includes("moneySeries")
              ? undefined
              : {
                  label: "Daily revenue",
                  points: rows.map((point) => ({ label: point.label, value: point.received })),
                  format: (value) => money(value * 100),
                  color: "var(--fm-admin-chart-1)",
                }
          }
        />
        <Metric title="Total orders" metric={data.orders} icon={ShoppingBag} />
        <Metric title="Total users" metric={data.users} icon={Users} />
        <Metric
          title="User growth"
          metric={data.userGrowth}
          format={(value) => `${number(value)}%`}
          icon={ArrowUpRight}
          rate
          sparkline={
            data.deniedSections.includes("userSeries")
              ? undefined
              : {
                  label: "Cumulative user growth",
                  points: rows.map((point) => ({ label: point.label, value: point.userGrowth })),
                  format: (value) => `${number(value)}%`,
                  color: "var(--fm-commerce-positive)",
                }
          }
        />
        <Metric
          title="Monthly revenue"
          metric={data.monthlyRevenue}
          format={money}
          icon={CalendarDays}
        />
        <Metric
          title="Yearly revenue"
          metric={data.yearlyRevenue}
          format={money}
          icon={CalendarDays}
        />
        <Metric
          title="Returning rate"
          metric={data.returningRate}
          format={(value) => `${number(value)}%`}
          icon={Users}
          rate
        />
        <Metric
          title="Refunded"
          metric={data.refunds}
          format={money}
          icon={CreditCard}
          lowerIsBetter
        />
      </div>
      <div className="grid min-w-0 gap-6 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader>
            <CardTitle>Revenue over time</CardTitle>
            <CardDescription>{periodLabel} · PHP</CardDescription>
            <CardAction>
              <Badge variant="outline">{data.period.replace("d", " days")}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {data.revenue.value === null ||
            !rows.length ||
            data.deniedSections.includes("moneySeries") ? (
              <Empty
                message={
                  data.revenue.unavailableReason ?? "Daily revenue is unavailable for this period."
                }
              />
            ) : (
              <ChartContainer
                className="h-72 w-full"
                config={{
                  received: { label: "Received", color: "var(--fm-admin-chart-1)" },
                  refunded: { label: "Refunded", color: "var(--fm-admin-chart-3)" },
                }}
              >
                <AreaChart accessibilityLayer data={rows} margin={{ left: 0, right: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={30} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) =>
                      new Intl.NumberFormat("en-PH", { notation: "compact" }).format(value)
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <span>
                            {name === "received" ? "Received" : "Refunded"}:{" "}
                            {money(Number(value) * 100)}
                          </span>
                        )}
                      />
                    }
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="received"
                    stroke="var(--color-received)"
                    fill="var(--color-received)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="refunded"
                    stroke="var(--color-refunded)"
                    fill="var(--color-refunded)"
                    fillOpacity={0.05}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
          <CardFooter>
            <p className="text-xs text-muted-foreground">
              Payments and refunds use their confirmation dates. These figures are not profit.
            </p>
          </CardFooter>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Customer activity</CardTitle>
            <CardDescription>Purchases and registrations in this period</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-semibold tabular-nums">
                  {data.purchasingCustomers.value === null
                    ? "—"
                    : number(data.purchasingCustomers.value)}
                </p>
                <p className="text-sm text-muted-foreground">purchasing customers</p>
              </div>
              <Badge variant="secondary">
                {data.returningRate.value === null
                  ? "—"
                  : `${number(data.returningRate.value)}% returning`}
              </Badge>
            </div>
            <Tabs defaultValue="purchases">
              <TabsList aria-label="Customer chart">
                <TabsTrigger value="purchases">Purchases</TabsTrigger>
                <TabsTrigger value="registrations">New users</TabsTrigger>
              </TabsList>
              <TabsContent value="purchases">
                {!rows.length || data.deniedSections.includes("purchaseSeries") ? (
                  <Empty message="Purchasing activity is unavailable for this period." />
                ) : (
                  <ChartContainer
                    className="mt-4 h-48 w-full"
                    config={{
                      customers: {
                        label: "Purchasing customers",
                        color: "var(--fm-admin-chart-2)",
                      },
                    }}
                  >
                    <BarChart accessibilityLayer data={rows}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={40} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        isAnimationActive={false}
                        dataKey="customers"
                        fill="var(--color-customers)"
                        radius={3}
                      />
                    </BarChart>
                  </ChartContainer>
                )}
              </TabsContent>
              <TabsContent value="registrations">
                {data.users.value === null ||
                !rows.length ||
                data.deniedSections.includes("userSeries") ? (
                  <Empty
                    message={
                      data.users.unavailableReason ??
                      "Registration activity is unavailable for this period."
                    }
                  />
                ) : (
                  <ChartContainer
                    className="mt-4 h-48 w-full"
                    config={{
                      newUsers: {
                        label: "New Customer accounts",
                        color: "var(--fm-admin-chart-2)",
                      },
                    }}
                  >
                    <BarChart accessibilityLayer data={rows}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={40} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        isAnimationActive={false}
                        dataKey="newUsers"
                        fill="var(--color-newUsers)"
                        radius={3}
                      />
                    </BarChart>
                  </ChartContainer>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
          <CardFooter>
            <p className="text-xs text-muted-foreground">
              A returning customer has an earlier paid order, including purchases before this
              period.
            </p>
          </CardFooter>
        </Card>
      </div>
      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Sales by product</CardTitle>
            <CardDescription>Top selling options by gross product sales · PHP</CardDescription>
          </CardHeader>
          <CardContent>
            {!data.products.length ? (
              <Empty
                message={data.productsUnavailableReason ?? "No paid product sales in this period."}
              />
            ) : (
              <ChartContainer
                className="h-72 w-full"
                config={{
                  grossSalesMinor: { label: "Gross sales", color: "var(--fm-admin-chart-2)" },
                }}
              >
                <BarChart
                  accessibilityLayer
                  layout="vertical"
                  data={data.products.map((p) => ({
                    ...p,
                    label: `${p.productName} · ${p.variantName}`,
                  }))}
                  margin={{ left: 0, right: 20 }}
                >
                  <CartesianGrid horizontal={false} />
                  <YAxis
                    dataKey="label"
                    type="category"
                    width={115}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) =>
                      String(value).length > 19 ? `${String(value).slice(0, 18)}…` : value
                    }
                  />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) =>
                      new Intl.NumberFormat("en-PH", { notation: "compact" }).format(value / 100)
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => <span>{money(Number(value))}</span>}
                      />
                    }
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="grossSalesMinor"
                    fill="var(--color-grossSalesMinor)"
                    radius={3}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
          <CardFooter>
            <p className="text-xs text-muted-foreground">
              Before discounts, delivery and refunds. Paid additions are included.
            </p>
          </CardFooter>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Best selling products</CardTitle>
            <CardDescription>Ranked by gross sales for the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {!data.products.length ? (
              <Empty
                message={data.productsUnavailableReason ?? "No paid product sales in this period."}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product / option</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.products.map((p, index) => (
                    <TableRow key={`${p.skuId}-${p.productName}-${p.variantName}-${p.unit}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Badge variant="outline">{index + 1}</Badge>
                          <div>
                            <p className="font-medium">{p.productName}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.variantName} · {p.unit}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {number(p.quantity)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(p.grossSalesMinor)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
          <CardFooter>
            <p className="text-xs text-muted-foreground">
              Quantities stay separate for each selling option and unit.
            </p>
          </CardFooter>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
            <CardDescription>Latest orders created in this period</CardDescription>
            {!data.deniedSections.includes("recentOrders") ? (
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/admin/orders">
                    View all
                    <ArrowUpRight data-icon="inline-end" />
                  </Link>
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            {!data.recentOrders.length ? (
              <Empty
                message={
                  data.deniedSections.includes("recentOrders")
                    ? "Global Orders access is required."
                    : "No orders created in this period."
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order / customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentOrders.map((o) => (
                    <TableRow key={o.orderId}>
                      <TableCell>
                        <Link
                          className="font-medium hover:underline"
                          href={`/admin/orders/${encodeURIComponent(o.orderId)}`}
                          prefetch={false}
                        >
                          {o.orderNumber ?? "View order"}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {o.customerName ?? "Customer"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {status(o.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(o.totalMinor, o.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Recent transactions</CardTitle>
            <CardDescription>Latest confirmed grocery payments in this period</CardDescription>
            {!data.deniedSections.includes("recentTransactions") ? (
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/admin/payments">
                    View all
                    <ArrowUpRight data-icon="inline-end" />
                  </Link>
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            {!data.recentTransactions.length ? (
              <Empty
                message={
                  data.deniedSections.includes("recentTransactions")
                    ? "Global Payments access is required."
                    : "No confirmed grocery payments in this period."
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment / date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentTransactions.map((p) => (
                    <TableRow key={p.paymentIntentId}>
                      <TableCell>
                        <Link
                          className="font-medium hover:underline"
                          href={`/admin/payments/transactions/${encodeURIComponent(p.paymentIntentId)}`}
                          prefetch={false}
                        >
                          {p.orderNumber ?? "Grocery payment"}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {new Date(p.confirmedAt).toLocaleDateString("en-PH", {
                            month: "short",
                            day: "numeric",
                            timeZone: data.timezone,
                          })}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {status(p.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(p.amountMinor, p.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        {periodLabel} · {data.timezone} · Updated{" "}
        {new Date(data.computedAt).toLocaleTimeString("en-PH", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: data.timezone,
        })}
      </p>
    </div>
  );
}

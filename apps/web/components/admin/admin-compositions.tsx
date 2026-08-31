import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function AdminDashboardGrid({
  ariaLabel,
  children,
  className,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-12", className)}
    >
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  freshness,
  href,
  unavailableReason = "Authoritative data is unavailable.",
  className,
}: {
  label: string;
  value: string | null;
  detail?: ReactNode;
  freshness?: string;
  href?: string;
  unavailableReason?: string;
  className?: string;
}) {
  return (
    <Card className={cn("gap-4 py-4 shadow-[var(--fm-shadow-card)]", className)}>
      <CardHeader className="gap-1 px-4">
        <CardDescription>{label}</CardDescription>
        {value === null ? (
          <p className="text-sm font-medium text-[var(--fm-text-muted)]">{unavailableReason}</p>
        ) : (
          <CardTitle className="text-2xl tracking-[-0.03em]">{value}</CardTitle>
        )}
        {detail ? <div className="text-xs text-[var(--fm-text-muted)]">{detail}</div> : null}
      </CardHeader>
      {freshness || href ? (
        <CardContent className="flex items-center justify-between gap-3 border-t px-4 pt-3 text-xs text-[var(--fm-text-muted)]">
          <span>{freshness}</span>
          {href ? (
            <a
              className="font-medium text-[var(--fm-admin-accent-strong)] hover:underline"
              href={href}
            >
              Open workspace
            </a>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function AdminChartCard({
  title,
  description,
  action,
  summary,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  summary: ReadonlyArray<string>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      aria-label={title}
      className={cn("gap-4 py-0 shadow-[var(--fm-shadow-card)]", className)}
      role="figure"
    >
      <CardHeader className="border-b px-4 py-4 sm:px-5">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-5">
        {children}
        <ul className="sr-only">
          {summary.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function EditorLayout({
  editor,
  aside,
  asideLabel,
}: {
  editor: ReactNode;
  aside: ReactNode;
  asideLabel: string;
}) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">{editor}</div>
      <aside aria-label={asideLabel} className="self-start xl:sticky xl:top-20">
        {aside}
      </aside>
    </div>
  );
}

export function DetailWorkspace({
  summary,
  content,
  actions,
}: {
  summary: ReactNode;
  content: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-4 shadow-[var(--fm-shadow-card)] sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">{summary}</div>
        {actions ? (
          <div aria-label="Resource actions" className="flex flex-wrap gap-2" role="group">
            {actions}
          </div>
        ) : null}
      </div>
      <div className="min-w-0">{content}</div>
    </div>
  );
}

export type SettingsTab = { id: string; label: string; href: string; disabled?: boolean };

export function SettingsTabs({
  label,
  activeId,
  tabs,
}: {
  label: string;
  activeId: string;
  tabs: ReadonlyArray<SettingsTab>;
}) {
  return (
    <nav aria-label={label} className="overflow-x-auto border-b border-[var(--fm-border)]">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => (
          <a
            aria-current={activeId === tab.id ? "page" : undefined}
            aria-disabled={tab.disabled || undefined}
            className={cn(
              "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-[var(--fm-text-muted)]",
              activeId === tab.id &&
                "border-[var(--fm-admin-accent)] text-[var(--fm-admin-accent-strong)]",
              tab.disabled && "pointer-events-none opacity-50",
            )}
            href={tab.href}
            key={tab.id}
          >
            {tab.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function StepIndicator({
  currentStep,
  steps,
}: {
  currentStep: number;
  steps: ReadonlyArray<string>;
}) {
  return (
    <ol aria-label="Progress" className="grid gap-2 sm:grid-flow-col sm:auto-cols-fr">
      {steps.map((step, index) => {
        const number = index + 1;
        return (
          <li
            aria-current={number === currentStep ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 border-t-2 border-[var(--fm-border)] pt-2 text-xs text-[var(--fm-text-muted)]",
              number <= currentStep &&
                "border-[var(--fm-admin-accent)] font-medium text-[var(--fm-text)]",
            )}
            key={step}
          >
            <span aria-hidden="true">{number}</span>
            {step}
          </li>
        );
      })}
    </ol>
  );
}

export function CommandBanner({
  tone,
  title,
  message,
  action,
}: {
  tone: "info" | "pending" | "success" | "conflict" | "error";
  title: string;
  message: string;
  action?: ReactNode;
}) {
  const classes = {
    info: "border-[var(--fm-info-border)] bg-[var(--fm-info-soft)]",
    pending: "border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)]",
    success: "border-[var(--fm-success-border)] bg-[var(--fm-success-soft)]",
    conflict: "border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)]",
    error: "border-[var(--fm-danger-border)] bg-[var(--fm-danger-soft)]",
  };
  const isAlert = tone === "conflict" || tone === "error";
  return (
    <section
      aria-live={isAlert ? "assertive" : "polite"}
      className={cn(
        "flex flex-col gap-3 rounded-[var(--fm-radius-surface)] border p-4 sm:flex-row sm:items-center sm:justify-between",
        classes[tone],
      )}
      role={isAlert ? "alert" : "status"}
    >
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-[var(--fm-text-muted)]">{message}</p>
      </div>
      {action}
    </section>
  );
}

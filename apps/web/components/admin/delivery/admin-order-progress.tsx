import type { CustomerOrderProgressView } from "@freshmarkets/contracts";
import { Check, CreditCard, House, PackageCheck, Truck, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/admin/shadcn/card";
import { cn } from "@/lib/utils";

const milestones = {
  PAYMENT: { label: "Payment successful", icon: CreditCard },
  PACKED: { label: "Packed", icon: PackageCheck },
  OUT_FOR_DELIVERY: { label: "Out for delivery", icon: Truck },
  DELIVERED: { label: "Delivered", icon: House },
} satisfies Record<
  CustomerOrderProgressView["steps"][number]["key"],
  { label: string; icon: LucideIcon }
>;

export function AdminOrderProgress({ progress }: { progress: CustomerOrderProgressView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          Order progress
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol aria-label="Order progress" className="grid grid-cols-4">
          {progress.steps.map((step, index) => {
            const { label, icon: Icon } = milestones[step.key];
            const complete = step.state === "COMPLETE";
            return (
              <li
                key={step.key}
                data-progress-state={step.state}
                aria-current={step.state === "CURRENT" ? "step" : undefined}
                className="relative min-w-0 pr-2 last:pr-0"
              >
                {index < progress.steps.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-4 right-0 top-[15px] h-0.5",
                      progress.steps[index + 1]?.state === "COMPLETE" ? "bg-primary" : "bg-border",
                    )}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative flex size-8 items-center justify-center rounded-full border-2",
                    complete
                      ? "border-primary bg-primary text-primary-foreground"
                      : step.state === "CURRENT"
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground",
                  )}
                >
                  {complete ? <Check className="size-4" /> : <Icon className="size-4" />}
                </span>
                <p
                  className={cn(
                    "mt-3 break-words text-xs font-medium leading-tight",
                    complete
                      ? "text-primary"
                      : step.state === "CURRENT"
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {label}
                </p>
                <span className="sr-only">
                  {complete
                    ? "Completed"
                    : step.state === "CURRENT"
                      ? "In progress"
                      : "Not started"}
                </span>
                {step.achievedAt ? (
                  <time
                    dateTime={step.achievedAt}
                    className="mt-1 block break-words text-xs text-muted-foreground"
                  >
                    {new Date(step.achievedAt).toLocaleString()}
                  </time>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {progress.detail}
        </p>
      </CardContent>
    </Card>
  );
}

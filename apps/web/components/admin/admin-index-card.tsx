import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./shadcn/card";

/** Orders-style frame for Admin index pages with their own filters and results. */
export function AdminIndexCard({
  title,
  description,
  action,
  children,
  footer,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden border-border py-0 shadow-none">
      <CardHeader className="gap-1 px-4 pt-6 pb-5 sm:px-6 sm:pt-8 sm:pb-7">
        <CardTitle>
          <h1 id="admin-page-title" className="text-2xl font-semibold tracking-tight">
            {title}
          </h1>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4 pb-4 sm:px-6">{children}</CardContent>
      {footer ? (
        <CardFooter className="flex-col items-start gap-1 px-4 pt-2 pb-5 sm:flex-row sm:justify-between sm:px-6">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function AdminIndexPageCount({
  visible,
  loaded,
  singular,
  plural,
}: {
  visible: number;
  loaded: number;
  singular: string;
  plural: string;
}) {
  return (
    <span className="text-sm text-muted-foreground">
      Showing {visible} of {loaded} {loaded === 1 ? singular : plural} on this page
    </span>
  );
}

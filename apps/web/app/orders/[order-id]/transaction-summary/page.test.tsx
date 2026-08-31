import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useParams: () => ({ "order-id": "order-1" }) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("../../../../components/storefront/storefront-shell", () => ({
  StorefrontShell: ({ children }: { children: ReactNode }) => children,
}));
import TransactionSummaryPage from "./page";

describe("TransactionSummaryPage", () => {
  it("renders a bounded loading state before the owned summary arrives", () => {
    expect(renderToStaticMarkup(<TransactionSummaryPage />)).toContain(
      "Loading transaction summary",
    );
  });
});

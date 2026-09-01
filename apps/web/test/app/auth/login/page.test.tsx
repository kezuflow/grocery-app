import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/freshmarkets-auth-provider", () => ({
  FreshMarketsAuthProvider: ({
    children,
    redirectTo,
  }: {
    children: ReactNode;
    redirectTo: string;
  }) => <div data-redirect-to={redirectTo}>{children}</div>,
}));
vi.mock("@/components/auth/sign-in", () => ({
  SignIn: () => <div>Sign in form</div>,
}));

import LoginPage from "@/app/auth/login/page";

describe("LoginPage", () => {
  it("continues to the requested internal route after authentication", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({ redirectTo: "/admin" }) });
    expect(renderToStaticMarkup(page)).toContain('data-redirect-to="/admin"');
  });

  it("supports existing returnTo links and rejects external destinations", async () => {
    const legacy = await LoginPage({ searchParams: Promise.resolve({ returnTo: "/checkout" }) });
    const external = await LoginPage({
      searchParams: Promise.resolve({ redirectTo: "https://example.com/admin" }),
    });

    expect(renderToStaticMarkup(legacy)).toContain('data-redirect-to="/checkout"');
    expect(renderToStaticMarkup(external)).toContain('data-redirect-to="/"');
  });
});

"use client";

import type { AuthView } from "@better-auth-ui/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ComponentPropsWithoutRef,
  type ComponentType,
  type MouseEvent,
  type PropsWithChildren,
  type ReactNode,
  useMemo,
} from "react";
import { authClient } from "@/lib/auth/auth-client";
import { AuthProvider } from "./auth-provider";

type AuthLinkProps = PropsWithChildren<
  { className?: string; href: string; to?: string } & Pick<
    ComponentPropsWithoutRef<"a">,
    "aria-disabled" | "tabIndex" | "onClick"
  >
>;

const AUTH_VIEW_BY_PATH: Record<string, AuthView> = {
  "/auth/callback": "callback",
  "/auth/error": "error",
  "/auth/redirect": "redirect",
  "/auth/login": "signIn",
  "/auth/register": "signUp",
  "/auth/forgot-password": "forgotPassword",
  "/auth/reset-password": "resetPassword",
  "/auth/reset-link-sent": "resetLinkSent",
  "/auth/verify-email": "verifyEmail",
};

function getAuthView(to: string): AuthView | undefined {
  try {
    return AUTH_VIEW_BY_PATH[new URL(to, "https://freshmarkets.local").pathname];
  } catch {
    return undefined;
  }
}

export function FreshMarketsAuthProvider({
  children,
  redirectTo = "/",
  onAuthViewChange,
}: {
  children: ReactNode;
  redirectTo?: string;
  onAuthViewChange?: (view: AuthView) => void;
}) {
  const router = useRouter();
  const AuthLink = useMemo<ComponentType<AuthLinkProps>>(() => {
    if (!onAuthViewChange) return Link;

    return function DialogAuthLink({ href, onClick, ...props }) {
      const authView = getAuthView(href);

      if (!authView) return <Link href={href} onClick={onClick} {...props} />;

      return (
        <a
          href={href}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            onClick?.(event);
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }

            event.preventDefault();
            onAuthViewChange(authView);
          }}
          {...props}
        />
      );
    };
  }, [onAuthViewChange]);

  return (
    <AuthProvider
      authClient={authClient}
      navigate={({ to, replace }) => {
        const authView = getAuthView(to);
        if (authView && onAuthViewChange) {
          onAuthViewChange(authView);
          return;
        }

        if (replace) router.replace(to);
        else router.push(to);
      }}
      Link={AuthLink}
      redirectTo={redirectTo}
      socialProviders={["google"]}
      emailAndPassword={{
        enabled: true,
        forgotPassword: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
      }}
      viewPaths={{
        auth: {
          signIn: "login",
          signUp: "register",
          forgotPassword: "forgot-password",
          resetPassword: "reset-password",
        },
      }}
    >
      {children}
    </AuthProvider>
  );
}

"use client";

import {
  AuthProvider as AuthProviderPrimitive,
  type AuthPlugin as ReactAuthPlugin,
  type AuthProviderProps,
} from "@better-auth-ui/react";
import {
  createContext,
  useContext,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type PropsWithChildren,
  type ReactNode,
} from "react";

import { ErrorToaster } from "./error-toaster";

const AuthToasterContext = createContext("auth");

export function useAuthToasterId() {
  return useContext(AuthToasterContext);
}

declare module "@better-auth-ui/core" {
  interface AuthPluginRegister {
    freshmarketsShadcn: ReactAuthPlugin;
  }

  interface AuthConfig {
    /**
     * React component used to render internal navigation links.
     * Typically TanStack Router's `Link` or Next.js's `Link`.
     */
    Link: ComponentType<
      PropsWithChildren<
        { className?: string; href: string; to?: string } & Pick<
          ComponentPropsWithoutRef<"a">,
          "aria-disabled" | "tabIndex" | "onClick"
        >
      >
    >;
  }

  /** Widen `AdditionalField.label` to `ReactNode` in the shadcn package. */
  interface AdditionalFieldRegister {
    label: ReactNode;
  }
}

/**
 * Provides the authentication context and routes its toasts to this surface's toaster.
 *
 * @param children - React nodes to render inside the authentication provider
 * @returns A React element that renders an authentication provider configured with the provided props and toast handler
 */
export function AuthProvider({
  children,
  toasterId = "auth",
  ...config
}: AuthProviderProps & { toasterId?: string }) {
  return (
    <AuthToasterContext.Provider value={toasterId}>
      <AuthProviderPrimitive {...config}>
        {children}
        <ErrorToaster toasterId={toasterId} />
      </AuthProviderPrimitive>
    </AuthToasterContext.Provider>
  );
}

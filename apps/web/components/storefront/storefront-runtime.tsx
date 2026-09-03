"use client";

import { createContext, useContext, type ReactNode } from "react";

const StorefrontRuntimeContext = createContext<
  Readonly<{
    mapboxPublicAccessToken?: string;
  }>
>({});

export function StorefrontRuntimeProvider({
  children,
  mapboxPublicAccessToken,
}: Readonly<{
  children: ReactNode;
  mapboxPublicAccessToken?: string;
}>) {
  return (
    <StorefrontRuntimeContext.Provider value={{ mapboxPublicAccessToken }}>
      {children}
    </StorefrontRuntimeContext.Provider>
  );
}

export function useStorefrontRuntime() {
  return useContext(StorefrontRuntimeContext);
}

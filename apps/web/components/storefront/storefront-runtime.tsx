"use client";

import { createContext, useContext, type ReactNode } from "react";

const StorefrontRuntimeContext = createContext<
  Readonly<{
    googleMapsBrowserApiKey?: string;
    googleMapsMapId?: string;
  }>
>({});

export function StorefrontRuntimeProvider({
  children,
  googleMapsBrowserApiKey,
  googleMapsMapId,
}: Readonly<{
  children: ReactNode;
  googleMapsBrowserApiKey?: string;
  googleMapsMapId?: string;
}>) {
  return (
    <StorefrontRuntimeContext.Provider value={{ googleMapsBrowserApiKey, googleMapsMapId }}>
      {children}
    </StorefrontRuntimeContext.Provider>
  );
}

export function useStorefrontRuntime() {
  return useContext(StorefrontRuntimeContext);
}

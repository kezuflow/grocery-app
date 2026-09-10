import { createContext, useContext } from "react";

type QuickViewContextValue = {
  openProduct: (slug: string) => void;
};

export const QuickViewContext = createContext<QuickViewContextValue | null>(null);

export function useQuickView(): QuickViewContextValue {
  const context = useContext(QuickViewContext);
  if (!context) throw new Error("useQuickView requires QuickViewProvider");
  return context;
}

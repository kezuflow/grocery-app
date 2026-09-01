"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type AdminTheme = "light" | "dark";

const ADMIN_THEME_STORAGE_KEY = "fm-admin-theme";
const AdminThemeContext = createContext<{
  theme: AdminTheme;
  toggleTheme: () => void;
}>({ theme: "light", toggleTheme: () => undefined });

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AdminTheme>("light");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("fm-admin-dark", theme === "dark");
    return () => document.documentElement.classList.remove("fm-admin-dark");
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () =>
        setTheme((current) => {
          const next = current === "light" ? "dark" : "light";
          window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, next);
          return next;
        }),
    }),
    [theme],
  );

  return <AdminThemeContext.Provider value={value}>{children}</AdminThemeContext.Provider>;
}

export function useAdminTheme() {
  return useContext(AdminThemeContext);
}

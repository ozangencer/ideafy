"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { ReactNode, useEffect } from "react";

export const PURE_WHITE_STORAGE_KEY = "ideafy:pure-white";

export function isPureWhiteEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PURE_WHITE_STORAGE_KEY) === "1";
}

export function setPureWhiteEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  if (enabled) {
    window.localStorage.setItem(PURE_WHITE_STORAGE_KEY, "1");
  } else {
    window.localStorage.removeItem(PURE_WHITE_STORAGE_KEY);
  }
  applyPureWhiteClass(enabled);
  window.dispatchEvent(new CustomEvent("ideafy:pure-white-change", { detail: enabled }));
}

function applyPureWhiteClass(enabled: boolean) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (enabled) html.classList.add("pure-white");
  else html.classList.remove("pure-white");
}

function PureWhiteSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    applyPureWhiteClass(resolvedTheme === "light" && isPureWhiteEnabled());
  }, [resolvedTheme]);
  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <PureWhiteSync />
      {children}
    </NextThemesProvider>
  );
}

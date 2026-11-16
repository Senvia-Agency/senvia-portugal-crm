import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ThemeProvider } from "next-themes";

/** localStorage key for the person's choice ("light", "dark" or "system"). Also read by the pre-paint script in index.html. */
export const THEME_STORAGE_KEY = "senvia-theme";

/**
 * Pages seen by a company's customers or by people who are not signed in.
 * They keep the light look the company published, whatever theme the visitor
 * picked inside the CRM on the same browser.
 */
const PUBLIC_PATHS = [
  /^\/$/, /^\/login\/?$/, /^\/reset-password/, /^\/f\//, /^\/c\//, /^\/confirmar-lead/, /^\/invite\//,
  /^\/precos/, /^\/privacy/, /^\/data-deletion/, /^\/terms/, /^\/install/,
  /^\/unsubscribe/, /^\/tutoriais/, /^\/tutorial\//, /^\/oauth\//,
];

export function isPublicThemePath(pathname: string) {
  return PUBLIC_PATHS.some(path => path.test(pathname));
}

/** Light, dark or the device's setting, saved on this device. Must sit inside the router. */
export function AppThemeProvider({ children }: { readonly children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      forcedTheme={isPublicThemePath(pathname) ? "light" : undefined}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}

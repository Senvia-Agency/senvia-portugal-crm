import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

export type ThemeChoice = "light" | "dark" | "system";

/** Labels are pt-PT i18n keys. */
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; hint: string; icon: LucideIcon }> = [
  { value: "light", label: "Claro", hint: "Fundo claro, como até agora.", icon: Sun },
  { value: "dark", label: "Escuro", hint: "Fundo escuro, mais confortável à noite.", icon: Moon },
  { value: "system", label: "Igual ao dispositivo", hint: "Segue o modo claro ou escuro do computador ou telemóvel.", icon: Monitor },
];

export function toThemeChoice(theme: string | undefined): ThemeChoice {
  return theme === "dark" || theme === "system" ? theme : "light";
}

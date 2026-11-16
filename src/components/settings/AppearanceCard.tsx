import { Check, Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n";
import { THEME_OPTIONS, toThemeChoice, type ThemeChoice } from "@/components/theme/theme-options";

/** Small picture of the CRM in each theme, so the choice is visible before clicking. */
function ThemePreview({ value }: { readonly value: ThemeChoice }) {
  const light = <span className="flex h-full w-full overflow-hidden rounded-md border border-slate-200 bg-slate-50">
    <span className="w-1/4 bg-slate-900" />
    <span className="flex flex-1 flex-col gap-1 p-1.5"><span className="h-1.5 w-2/3 rounded-full bg-slate-300" /><span className="h-4 rounded bg-white shadow-sm" /><span className="h-4 rounded bg-white shadow-sm" /></span>
  </span>;
  const dark = <span className="flex h-full w-full overflow-hidden rounded-md border border-slate-700 bg-slate-950">
    <span className="w-1/4 bg-black" />
    <span className="flex flex-1 flex-col gap-1 p-1.5"><span className="h-1.5 w-2/3 rounded-full bg-slate-600" /><span className="h-4 rounded bg-slate-800" /><span className="h-4 rounded bg-slate-800" /></span>
  </span>;
  if (value === "light") return light;
  if (value === "dark") return dark;
  return <span className="relative block h-full w-full">
    {light}
    <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">{dark}</span>
  </span>;
}

/** "Aparência": light, dark or the device's setting, for this person on this device. */
export function AppearanceCard() {
  const { t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const current = toThemeChoice(theme);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" />{t("Aparência")}</CardTitle>
        <CardDescription>{t("Modo claro ou escuro para si, guardado neste dispositivo.")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="group" aria-label={t("Aparência")} className="grid gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map(option => {
            const selected = current === option.value;
            const Icon = option.icon;
            return (
              <button key={option.value} type="button" aria-pressed={selected} onClick={() => setTheme(option.value)}
                className={cn("flex flex-col gap-2.5 rounded-xl border p-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted")}>
                <span aria-hidden="true" className="block h-16"><ThemePreview value={option.value} /></span>
                <span className="flex items-start gap-2">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block", selected ? "font-semibold text-primary" : "font-medium text-foreground")}>{t(option.label)}</span>
                    <span className="block text-xs text-muted-foreground">{t(option.hint)}</span>
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

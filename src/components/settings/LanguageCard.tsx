import { Check, Languages } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LANGUAGES, useLanguage } from "@/i18n";

/** "Idioma": the system language for this person, on this device. */
export function LanguageCard() {
  const { t, language, setLanguage } = useLanguage();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Languages className="h-5 w-5" />{t("Idioma")}</CardTitle>
        <CardDescription>{t("O idioma dos menus e dos ecrãs. Fica guardado neste dispositivo.")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-3">
        {LANGUAGES.map(l => (
          <button key={l.code} type="button" onClick={() => setLanguage(l.code)} aria-pressed={language === l.code}
            className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
              language === l.code ? "border-primary bg-primary/5 font-semibold text-primary" : "hover:bg-muted")}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">{l.short}</span>
            <span className="flex-1">{l.label}</span>
            {language === l.code && <Check className="h-4 w-4" />}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

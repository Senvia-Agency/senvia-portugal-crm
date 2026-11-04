import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/i18n";

interface ImportResult {
  imported: number;
  updated: number;
  duplicates: number;
  errors: number;
}

interface Props {
  updateExisting: boolean;
  onUpdateExistingChange: (v: boolean) => void;
  clearEmptyFields: boolean;
  onClearEmptyFieldsChange: (v: boolean) => void;
  optInCertified: boolean;
  onOptInCertifiedChange: (v: boolean) => void;
  importing: boolean;
  progress: number;
  result: ImportResult | null;
  onImport: () => void;
  onClose: () => void;
}

export function ImportStep4Finalize({
  updateExisting, onUpdateExistingChange,
  clearEmptyFields, onClearEmptyFieldsChange,
  optInCertified, onOptInCertifiedChange,
  importing, progress, result,
  onImport, onClose,
}: Props) {
  const { t } = useLanguage();
  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Check className="h-7 w-7 text-primary" />
          </div>
        </div>
        <p className="text-center font-semibold">{t("Importação concluída!")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-lg font-bold text-primary">{result.imported}</p>
            <p className="text-xs text-muted-foreground">{t("Novos")}</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-lg font-bold text-blue-500">{result.updated}</p>
            <p className="text-xs text-muted-foreground">{t("Atualizados")}</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-lg font-bold text-amber-500">{result.duplicates}</p>
            <p className="text-xs text-muted-foreground">{t("Existentes")}</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-lg font-bold text-destructive">{result.errors}</p>
            <p className="text-xs text-muted-foreground">{t("Erros")}</p>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>{t("Fechar")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Contact management */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">{t("Gestão de contactos")}</h4>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="update-existing" className="text-sm cursor-pointer flex-1">
            {t("Atualizar os atributos existentes de contactos")}
          </Label>
          <Switch id="update-existing" checked={updateExisting} onCheckedChange={onUpdateExistingChange} />
        </div>
        {updateExisting && (
          <div className="flex items-center justify-between gap-3 pl-4 border-l-2 border-muted">
            <Label htmlFor="clear-empty" className="text-sm cursor-pointer flex-1 text-muted-foreground">
              {t("Importar campos vazios para apagar dados existentes")}
            </Label>
            <Switch id="clear-empty" checked={clearEmptyFields} onCheckedChange={onClearEmptyFieldsChange} />
          </div>
        )}
      </div>

      {/* Opt-in certification */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">{t("Certificação Opt-in")}</h4>
        <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
          <Checkbox
            id="opt-in"
            checked={optInCertified}
            onCheckedChange={(v) => onOptInCertifiedChange(!!v)}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor="opt-in" className="text-sm cursor-pointer font-medium">
              {t("Certifico que os novos contactos importados cumprem estas condições:")}
            </Label>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-4">
              <li>{t("Os meus contactos concordaram em receber campanhas por email ou WhatsApp")}</li>
              <li>{t("Estes contactos não foram obtidos de terceiros")}</li>
              <li>{t("Estes contactos não foram comprados ou alugados")}</li>
            </ul>
          </div>
        </div>
      </div>

      {importing && (
        <div className="space-y-2">
          <Progress value={progress} />
          <p className="text-xs text-center text-muted-foreground">{t("A importar... {{progress}}%", { progress })}</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onImport} disabled={!optInCertified || importing}>
          {importing ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("A importar...")}</>
          ) : (
            t("Confirmar importação")
          )}
        </Button>
      </div>
    </div>
  );
}

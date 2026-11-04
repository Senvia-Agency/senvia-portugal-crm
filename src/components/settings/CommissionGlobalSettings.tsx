import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Info, Percent, TrendingUp, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrganization, useUpdateOrganization } from "@/hooks/useOrganization";
import { useLanguage } from "@/i18n";

type CommissionMode = "global" | "per_product";

interface SalesSettings {
  commissions_enabled?: boolean;
  commission_percentage?: number | null;
  commission_mode?: CommissionMode;
  [key: string]: unknown;
}

/**
 * Org-wide commission settings. For non-telecom orgs the admin chooses a mode:
 * a single global % over the sale total, or per-product commission values set
 * in the product catalog. Telecom/energy orgs keep the matrix below.
 * Persists in `organizations.sales_settings`.
 */
export function CommissionGlobalSettings() {
  const { data: org } = useOrganization();
  const updateOrganization = useUpdateOrganization();
  const { t } = useLanguage();
  const currentSettings: SalesSettings = (org?.sales_settings as SalesSettings) || {};
  const isTelecom = (org as { niche?: string } | undefined)?.niche === "telecom";

  const [enabled, setEnabled] = useState(false);
  const [percentage, setPercentage] = useState("");
  const [mode, setMode] = useState<CommissionMode>("global");

  useEffect(() => {
    setEnabled(!!currentSettings.commissions_enabled);
    const pct = currentSettings.commission_percentage;
    setPercentage(pct != null && pct > 0 ? String(pct) : "");
    setMode(currentSettings.commission_mode || (pct != null && pct > 0 ? "global" : "per_product"));
  }, [org?.sales_settings]);

  const parsedPct = percentage ? parseFloat(percentage) : null;
  const currentPct = currentSettings.commission_percentage != null && currentSettings.commission_percentage > 0
    ? currentSettings.commission_percentage
    : null;
  const currentMode = currentSettings.commission_mode || (currentPct ? "global" : "per_product");

  const hasChanges =
    enabled !== !!currentSettings.commissions_enabled ||
    (parsedPct || null) !== (currentPct || null) ||
    (!isTelecom && mode !== currentMode);

  const handleSave = () => {
    updateOrganization.mutate({
      sales_settings: {
        ...currentSettings,
        commissions_enabled: enabled,
        commission_percentage: parsedPct && parsedPct > 0 ? parsedPct : null,
        ...(isTelecom ? {} : { commission_mode: mode }),
      },
    });
  };

  // For non-telecom, the global % field only matters in "global" mode.
  const showPercentage = enabled && (isTelecom || mode === "global");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Percent className="h-4 w-4" />
          {t('Regras gerais')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="commissions_enabled_matrix" className="font-medium cursor-pointer">
              {t('Comissões sobre vendas')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('Liga o cálculo de comissões nesta organização.')}
            </p>
          </div>
          <Switch
            id="commissions_enabled_matrix"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {/* Mode selector — non-telecom orgs only */}
        {enabled && !isTelecom && (
          <div className="space-y-2 border-t pt-5">
            <Label className="text-sm">{t('Como calcular a comissão?')}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("global")}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                  mode === "global" ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">{t('Comissão global')}</p>
                  <p className="text-xs text-muted-foreground">{t('Uma % sobre o valor total de cada venda.')}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode("per_product")}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                  mode === "per_product" ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <Package className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">{t('Comissão por produto/serviço')}</p>
                  <p className="text-xs text-muted-foreground">{t('Valor definido na ficha de cada produto.')}</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {showPercentage && (
          <div className="space-y-3 border-t pt-5">
            <div className="space-y-2">
              <Label htmlFor="commission_percentage_matrix" className="text-sm">
                {t('Percentagem global (%)')}
              </Label>
              <Input
                id="commission_percentage_matrix"
                type="number"
                min="0"
                max="100"
                step="0.5"
                placeholder={t('Ex: 10')}
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="flex gap-2 p-3 rounded-md bg-muted/50 border">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                {isTelecom
                  ? t('Aplicada como fallback sobre o valor total da venda quando os produtos não têm comissão configurada. Para regras detalhadas por produto ou energia, usa as secções abaixo.')
                  : t('Aplicada sobre o valor total de cada venda.')}
              </p>
            </div>
          </div>
        )}

        {/* Per-product note — non-telecom */}
        {enabled && !isTelecom && mode === "per_product" && (
          <div className="flex gap-2 rounded-md border bg-muted/50 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('Define a comissão de cada produto/serviço em Definições > Produtos (campo "Comissão por unidade"). Produtos sem valor definido não geram comissão.')}
            </p>
          </div>
        )}

        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateOrganization.isPending}
          className="w-full sm:w-auto"
        >
          {updateOrganization.isPending ? t('A guardar...') : t('Guardar')}
        </Button>
      </CardContent>
    </Card>
  );
}

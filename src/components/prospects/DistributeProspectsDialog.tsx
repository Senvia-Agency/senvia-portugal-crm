import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useDistributeProspects } from "@/hooks/useProspects";
import type { ProspectSalesperson } from "@/types/prospects";
import { Loader2, Users } from "lucide-react";
import { useLanguage } from "@/i18n";

interface DistributeProspectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  selectedIds: string[];
  salespeople: ProspectSalesperson[];
  onDistributed?: () => void;
}

type DistributionMode = "all" | "selected";

export function DistributeProspectsDialog({
  open,
  onOpenChange,
  selectedCount,
  selectedIds,
  salespeople,
  onDistributed,
}: DistributeProspectsDialogProps) {
  const distributeProspects = useDistributeProspects();
  const { t } = useLanguage();
  const [quantityInput, setQuantityInput] = useState(String(selectedCount));
  const [mode, setMode] = useState<DistributionMode>("all");
  const [selectedSalespersonIds, setSelectedSalespersonIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setQuantityInput(String(selectedCount));
      setMode("all");
      setSelectedSalespersonIds([]);
    }
  }, [open, selectedCount]);

  const parsedQuantity = useMemo(() => {
    const trimmedValue = quantityInput.trim();
    if (!trimmedValue) return 0;
    const value = Number.parseInt(trimmedValue, 10);
    return Number.isNaN(value) ? 0 : value;
  }, [quantityInput]);

  const hasValidQuantity = parsedQuantity >= 1 && parsedQuantity <= selectedCount;
  const hasValidSalespeople = mode === "all" ? salespeople.length > 0 : selectedSalespersonIds.length > 0;

  const isDisabled =
    selectedIds.length === 0 ||
    !hasValidSalespeople ||
    distributeProspects.isPending ||
    !hasValidQuantity;

  const toggleSalesperson = (userId: string) => {
    setSelectedSalespersonIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleDistribute = async () => {
    if (isDisabled) return;

    try {
      await distributeProspects.mutateAsync({
        prospectIds: selectedIds,
        quantity: parsedQuantity,
        salespersonIds: mode === "selected" ? selectedSalespersonIds : undefined,
      });
      onDistributed?.();
      onOpenChange(false);
    } catch {
      // Error is handled by the mutation's onError callback
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex h-full flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-4 md:px-6">
          <DialogTitle>{t("Distribuir leads selecionados")}</DialogTitle>
          <DialogDescription>
            {t("Escolhe quantos dos prospects selecionados queres distribuir e para quais comerciais.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
            {/* Left column */}
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4">
                <p className="text-sm font-medium">{t("Quantidade selecionada")}</p>
                <p className="mt-2 text-3xl font-semibold">{selectedCount}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("Estes são os prospects elegíveis que selecionaste na lista.")}
                </p>
              </div>

              <div className="rounded-xl border bg-card p-4">
                <label htmlFor="prospects-quantity" className="text-sm font-medium">
                  {t("Quantidade a distribuir")}
                </label>
                <Input
                  id="prospects-quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={selectedCount}
                  step={1}
                  value={quantityInput}
                  onChange={(event) => setQuantityInput(event.target.value)}
                  className="mt-3"
                />
                <p className="mt-2 text-sm text-muted-foreground">
                  {t(selectedCount === 1 ? "Podes distribuir entre 1 e {{n}} prospect." : "Podes distribuir entre 1 e {{n}} prospects.", { n: selectedCount })}
                </p>
                {!hasValidQuantity ? (
                  <p className="mt-2 text-sm text-destructive">
                    {t("Introduz uma quantidade válida dentro do total selecionado.")}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t(parsedQuantity === 1 ? "Será distribuído o primeiro prospect da seleção atual." : "Serão distribuídos os primeiros {{n}} prospects da seleção atual.", { n: parsedQuantity })}
                  </p>
                )}
              </div>
            </div>

            {/* Right column — salespeople */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">{t("Comerciais")}</p>
              </div>

              {salespeople.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  {t("Não existem comerciais elegíveis nesta organização.")}
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  <RadioGroup
                    value={mode}
                    onValueChange={(v) => setMode(v as DistributionMode)}
                    className="gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="all" id="mode-all" />
                      <Label htmlFor="mode-all" className="cursor-pointer text-sm">
                        {t("Todos os comerciais (round-robin)")}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="selected" id="mode-selected" />
                      <Label htmlFor="mode-selected" className="cursor-pointer text-sm">
                        {t("Comerciais selecionados")}
                      </Label>
                    </div>
                  </RadioGroup>

                  {mode === "selected" && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedSalespersonIds(salespeople.map((s) => s.user_id))}
                        >
                          {t("Selecionar todos")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedSalespersonIds([])}
                        >
                          {t("Limpar")}
                        </Button>
                      </div>

                      <div className="space-y-2">
                        {salespeople.map((sp) => (
                          <div key={sp.user_id} className="flex items-center gap-2">
                            <Checkbox
                              id={`sp-${sp.user_id}`}
                              checked={selectedSalespersonIds.includes(sp.user_id)}
                              onCheckedChange={() => toggleSalesperson(sp.user_id)}
                            />
                            <Label htmlFor={`sp-${sp.user_id}`} className="cursor-pointer text-sm">
                              {sp.full_name}
                            </Label>
                          </div>
                        ))}
                      </div>

                      {selectedSalespersonIds.length === 0 && (
                        <p className="text-sm text-destructive">
                          {t("Seleciona pelo menos um comercial.")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t px-4 py-4 md:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
            <Button onClick={handleDistribute} disabled={isDisabled}>
              {distributeProspects.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t(parsedQuantity === 1 ? "Distribuir {{n}} lead" : "Distribuir {{n}} leads", { n: parsedQuantity || 0 })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

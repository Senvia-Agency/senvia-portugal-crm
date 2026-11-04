import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActivationObjectives } from "@/hooks/useActivationObjectives";
import { useLanguage } from "@/i18n";

interface Member {
  user_id: string;
  full_name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodType: "monthly" | "annual";
  proposalType: "energia" | "servicos";
  members: Member[];
}

export function EditActivationObjectivesModal({ open, onOpenChange, periodType, proposalType, members }: Props) {
  const { t } = useLanguage();
  const { getTarget, saveObjective } = useActivationObjectives();
  const [values, setValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const initial: Record<string, number> = {};
      members.forEach((m) => {
        initial[m.user_id] = getTarget(m.user_id, periodType, proposalType);
      });
      setValues(initial);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, members, periodType, proposalType]);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [userId, qty] of Object.entries(values)) {
        await saveObjective.mutateAsync({
          userId,
          periodType,
          proposalType,
          targetQuantity: qty,
        });
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const periodLabel = periodType === "monthly" ? "Mensal" : "Anual";
  const typeLabel = proposalType === "energia" ? "Energia" : "Serviços";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {t("Objetivo {{period}} — {{type}}", { period: t(periodLabel), type: t(typeLabel) })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3">
              <Label className="text-xs flex-1 min-w-0 truncate">{m.full_name}</Label>
              <Input
                type="number"
                min={0}
                className="w-24 text-sm"
                value={values[m.user_id] || 0}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [m.user_id]: parseInt(e.target.value) || 0 }))
                }
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t("A guardar...") : t("Guardar")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

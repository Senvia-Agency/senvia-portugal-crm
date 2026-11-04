import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useMonthlyObjectives, ObjectiveTotals, MonthlyObjective } from "@/hooks/useMonthlyObjectives";
import { useTeamMembers } from "@/hooks/useTeam";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/hooks/useModules";
import { useLanguage } from "@/i18n";

interface EditObjectiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectives: MonthlyObjective[];
  preselectedUserId?: string;
}

export function EditObjectiveModal({ open, onOpenChange, objectives, preselectedUserId }: EditObjectiveModalProps) {
  const { t } = useLanguage();
  const { saveObjective } = useMonthlyObjectives();
  const { data: members = [] } = useTeamMembers();
  const { organization } = useAuth();
  const { modules } = useModules();
  const showEnergy = organization?.niche === 'telecom' && modules.energy;

  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [totals, setTotals] = useState<ObjectiveTotals>({
    total_nifs: 0,
    total_energia_mwh: 0,
    total_solar_kwp: 0,
    total_comissao: 0,
  });

  useEffect(() => {
    if (open) {
      const uid = preselectedUserId || members[0]?.user_id || "";
      setSelectedUserId(uid);
      const existing = objectives.find((o) => o.user_id === uid);
      setTotals(existing ? {
        total_nifs: Number(existing.total_nifs),
        total_energia_mwh: Number(existing.total_energia_mwh),
        total_solar_kwp: Number(existing.total_solar_kwp),
        total_comissao: Number(existing.total_comissao),
      } : { total_nifs: 0, total_energia_mwh: 0, total_solar_kwp: 0, total_comissao: 0 });
    }
  }, [open, preselectedUserId, members, objectives]);

  const handleUserChange = (uid: string) => {
    setSelectedUserId(uid);
    const existing = objectives.find((o) => o.user_id === uid);
    setTotals(existing ? {
      total_nifs: Number(existing.total_nifs),
      total_energia_mwh: Number(existing.total_energia_mwh),
      total_solar_kwp: Number(existing.total_solar_kwp),
      total_comissao: Number(existing.total_comissao),
    } : { total_nifs: 0, total_energia_mwh: 0, total_solar_kwp: 0, total_comissao: 0 });
  };

  const handleSave = () => {
    if (!selectedUserId) return;
    saveObjective.mutate({ userId: selectedUserId, totals }, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full p-0 gap-0">
        <DialogHeader className="p-4 md:p-6 pb-2">
          <DialogTitle>{t("Definir Objetivo Mensal")}</DialogTitle>
        </DialogHeader>

        <div className="px-4 md:px-6 pb-4 space-y-4">
          <div>
            <Label className="text-xs">{t("Colaborador")}</Label>
            <Select value={selectedUserId} onValueChange={handleUserChange}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={t("Selecionar colaborador")} />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Nº de NIFs")}</Label>
            <Input type="number" value={totals.total_nifs || ""} onChange={(e) => setTotals({ ...totals, total_nifs: Number(e.target.value) || 0 })} placeholder={t("Ex: {{value}}", { value: "5" })} className="h-9 text-sm" />
          </div>
          {showEnergy && (
            <>
              <div>
                <Label className="text-xs">{t("Total Energia (MWh)")}</Label>
                <Input type="number" step="0.01" value={totals.total_energia_mwh || ""} onChange={(e) => setTotals({ ...totals, total_energia_mwh: Number(e.target.value) || 0 })} placeholder={t("Ex: {{value}}", { value: "12.5" })} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("Total Solar (kWp)")}</Label>
                <Input type="number" step="0.01" value={totals.total_solar_kwp || ""} onChange={(e) => setTotals({ ...totals, total_solar_kwp: Number(e.target.value) || 0 })} placeholder={t("Ex: {{value}}", { value: "8.0" })} className="h-9 text-sm" />
              </div>
            </>
          )}
          <div>
            <Label className="text-xs">{t("Total Comissão (€)")}</Label>
            <Input type="number" step="0.01" value={totals.total_comissao || ""} onChange={(e) => setTotals({ ...totals, total_comissao: Number(e.target.value) || 0 })} placeholder={t("Ex: {{value}}", { value: "1200" })} className="h-9 text-sm" />
          </div>
        </div>

        <DialogFooter className="p-4 md:p-6 pt-2 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button>
          <Button onClick={handleSave} disabled={saveObjective.isPending || !selectedUserId}>
            {saveObjective.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {t("Guardar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

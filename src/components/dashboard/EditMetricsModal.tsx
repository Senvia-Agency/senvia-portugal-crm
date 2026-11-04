import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTeamMembers } from "@/hooks/useTeam";
import { useMonthlyMetrics, MonthlyMetric, MetricValues } from "@/hooks/useMonthlyMetrics";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/hooks/useModules";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/i18n";

interface EditMetricsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metrics: MonthlyMetric[];
}

export function EditMetricsModal({ open, onOpenChange, metrics }: EditMetricsModalProps) {
  const { t } = useLanguage();
  const { data: members = [] } = useTeamMembers();
  const { saveMetric } = useMonthlyMetrics();
  const { organization } = useAuth();
  const { modules } = useModules();
  const showEnergy = organization?.niche === 'telecom' && modules.energy;

  const [selectedUser, setSelectedUser] = useState<string>("");
  const [values, setValues] = useState<MetricValues>({
    op_energia: 0, energia: 0, op_solar: 0, solar: 0, op_comissao: 0, comissao: 0,
  });

  useEffect(() => {
    if (selectedUser && metrics.length > 0) {
      const existing = metrics.find((m) => m.user_id === selectedUser);
      if (existing) {
        setValues({
          op_energia: existing.op_energia,
          energia: existing.energia,
          op_solar: existing.op_solar,
          solar: existing.solar,
          op_comissao: existing.op_comissao,
          comissao: existing.comissao,
        });
        return;
      }
    }
    setValues({ op_energia: 0, energia: 0, op_solar: 0, solar: 0, op_comissao: 0, comissao: 0 });
  }, [selectedUser, metrics]);

  useEffect(() => {
    if (open && members.length > 0 && !selectedUser) {
      setSelectedUser(members[0].user_id);
    }
  }, [open, members, selectedUser]);

  const handleSave = () => {
    if (!selectedUser) return;
    saveMetric.mutate({ userId: selectedUser, values }, {
      onSuccess: () => onOpenChange(false),
    });
  };

  const handleChange = (field: keyof MetricValues, val: string) => {
    setValues((prev) => ({ ...prev, [field]: Number(val) || 0 }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full">
        <DialogHeader>
          <DialogTitle>{t("Definir Métricas Mensais")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Colaborador")}</Label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger>
                <SelectValue placeholder={t("Selecionar")} />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.user_id}>{m.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {showEnergy && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">{t("OP Energia")}</Label>
                  <Input type="number" value={values.op_energia} onChange={(e) => handleChange("op_energia", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("Energia (MWh)")}</Label>
                  <Input type="number" step="0.01" value={values.energia} onChange={(e) => handleChange("energia", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">OP Solar</Label>
                  <Input type="number" value={values.op_solar} onChange={(e) => handleChange("op_solar", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Solar (kWp)</Label>
                  <Input type="number" step="0.01" value={values.solar} onChange={(e) => handleChange("solar", e.target.value)} />
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label className="text-xs">{t("OP Comissão")}</Label>
              <Input type="number" value={values.op_comissao} onChange={(e) => handleChange("op_comissao", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Comissão (€)")}</Label>
              <Input type="number" step="0.01" value={values.comissao} onChange={(e) => handleChange("comissao", e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button>
          <Button onClick={handleSave} disabled={saveMetric.isPending || !selectedUser}>
            {saveMetric.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t("Guardar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

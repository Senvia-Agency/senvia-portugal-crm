import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, User, UserMinus } from "lucide-react";
import { useTeamMembers } from "@/hooks/useTeam";
import { useBulkAssignLeads, useBulkAssignClients } from "@/hooks/useBulkAssign";
import { toast } from "sonner";
import { useLanguage } from "@/i18n";

interface AssignTeamMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  entityType: "leads" | "clients";
  onSuccess: () => void;
}

export function AssignTeamMemberModal({
  open,
  onOpenChange,
  selectedIds,
  entityType,
  onSuccess,
}: AssignTeamMemberModalProps) {
  const { t } = useLanguage();
  const [selectedMemberId, setSelectedMemberId] = useState<string>("none");
  const { data: teamMembers = [], isLoading: isLoadingTeam } = useTeamMembers();
  
  const bulkAssignLeads = useBulkAssignLeads();
  const bulkAssignClients = useBulkAssignClients();
  
  const isSubmitting = bulkAssignLeads.isPending || bulkAssignClients.isPending;

  const handleConfirm = async () => {
    const assignedTo = selectedMemberId === "none" ? null : selectedMemberId;
    
    try {
      if (entityType === "leads") {
        await bulkAssignLeads.mutateAsync({
          leadIds: selectedIds,
          assignedTo,
        });
      } else {
        await bulkAssignClients.mutateAsync({
          clientIds: selectedIds,
          assignedTo,
        });
      }
      
      const successKey = entityType === "leads"
        ? (assignedTo ? "{{n}} leads atribuídos com sucesso" : "{{n}} leads desatribuídos com sucesso")
        : (assignedTo ? "{{n}} clientes atribuídos com sucesso" : "{{n}} clientes desatribuídos com sucesso");
      toast.success(t(successKey, { n: selectedIds.length }));
      
      onSuccess();
      onOpenChange(false);
      setSelectedMemberId("none");
    } catch (error) {
      toast.error(t("Erro ao atribuir colaborador"));
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Atribuir Colaborador")}</DialogTitle>
          <DialogDescription>
            {t(entityType === "leads" ? "Selecione o colaborador para atribuir a {{n}} leads selecionados." : "Selecione o colaborador para atribuir a {{n}} clientes selecionados.", { n: selectedIds.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {isLoadingTeam ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <RadioGroup
              value={selectedMemberId}
              onValueChange={setSelectedMemberId}
              className="space-y-2"
            >
              {/* Option to remove assignment */}
              <div className="flex items-center space-x-3 rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="none" id="none" />
                <Label
                  htmlFor="none"
                  className="flex items-center gap-2 cursor-pointer flex-1"
                >
                  <UserMinus className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t("Nenhum (remover atribuição)")}</span>
                </Label>
              </div>

              {teamMembers.filter((m) => !m.is_banned).map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center space-x-3 rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
                >
                  <RadioGroupItem value={member.user_id} id={member.user_id} />
                  <Label
                    htmlFor={member.user_id}
                    className="flex items-center gap-2 cursor-pointer flex-1"
                  >
                    <User className="h-4 w-4 text-primary" />
                    <span>{member.full_name}</span>
                  </Label>
                </div>
              ))}

              {teamMembers.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("Nenhum colaborador encontrado.")}
                </p>
              )}
            </RadioGroup>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting || isLoadingTeam}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("Confirmar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

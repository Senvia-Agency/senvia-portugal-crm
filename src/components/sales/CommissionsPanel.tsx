import { useState } from "react";
import { Percent, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamCommissionsTab } from "@/components/finance/TeamCommissionsTab";
import { CommissionAnalysisTab } from "@/components/finance/CommissionAnalysisTab";
import { MinhasComissoesModal } from "@/components/finance/MinhasComissoesModal";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useMyCommissions } from "@/hooks/useSalesApproval";
import { hasPerfect2GetherAccess } from "@/lib/perfect2gether";
import { formatCurrency } from "@/lib/format";
import { commissionPortions } from "@/lib/commission-earnings";

// Commissions content, rendered inside the Vendas page as a tab. Admins see team
// commissions (+ analysis where applicable); salespeople see only their own.
export function CommissionsPanel() {
  const { organization, organizations } = useAuth();
  const { isAdmin, isSuperAdmin } = usePermissions();
  const { data: myCommissions } = useMyCommissions();
  const [myModalOpen, setMyModalOpen] = useState(false);

  // Outside telecom the commission follows the client's payments: confirmed is what
  // was already paid. Telecom keeps counting by sale status.
  const byPayment = organization?.niche !== "telecom";
  const myConfirmedTotal = (myCommissions || []).reduce((sum, s) => sum + (byPayment
    ? commissionPortions(s).confirmed
    : s.status === "delivered" || s.status === "fulfilled" ? Number(s.comissao) || 0 : 0), 0);
  const myPendingTotal = (myCommissions || []).reduce((sum, s) => sum + (byPayment
    ? commissionPortions(s).pending
    : s.status === "pending" || s.status === "in_progress" ? Number(s.comissao) || 0 : 0), 0);

  // Telecom/energy orgs use a different commission model (per CPE / contract /
  // DBL / consumo), so they get the specialised "Análise de Comissões" view —
  // not just the standard team summary. Gated by NICHE now (not a single org),
  // so every telecom org gets it (Perfect2Gether kept as a fallback).
  const isEnergyNiche = organization?.niche === "telecom";
  const canViewAnalysis =
    (isEnergyNiche ||
      hasPerfect2GetherAccess({ organizationId: organization?.id, memberships: organizations, isSuperAdmin })) &&
    isAdmin;

  const myCard = (
    <Card className="group cursor-pointer transition-colors hover:bg-muted/50" onClick={() => setMyModalOpen(true)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">As Minhas Comissões</CardTitle>
        <div className="flex items-center gap-1">
          <Percent className="h-4 w-4 text-emerald-500" />
          <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold text-emerald-600 md:text-2xl">{formatCurrency(myConfirmedTotal)}</div>
        <p className="text-xs text-muted-foreground">
          Confirmadas
          {myPendingTotal > 0 && <span className="ml-1">· {formatCurrency(myPendingTotal)} pendentes</span>}
        </p>
      </CardContent>
    </Card>
  );

  if (!isAdmin) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{myCard}</div>
        <MinhasComissoesModal open={myModalOpen} onOpenChange={setMyModalOpen} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{myCard}</div>

      {canViewAnalysis ? (
        <Tabs defaultValue={isEnergyNiche ? "analise" : "equipa"}>
          <TabsList>
            <TabsTrigger value="equipa">Comissões da equipa</TabsTrigger>
            <TabsTrigger value="analise">Análise de Comissões</TabsTrigger>
          </TabsList>
          <TabsContent value="equipa" className="mt-4">
            <TeamCommissionsTab />
          </TabsContent>
          <TabsContent value="analise" className="mt-4">
            <CommissionAnalysisTab />
          </TabsContent>
        </Tabs>
      ) : (
        <TeamCommissionsTab />
      )}

      <MinhasComissoesModal open={myModalOpen} onOpenChange={setMyModalOpen} />
    </div>
  );
}

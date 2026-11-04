import { useState } from "react";
import { ArrowLeft, Plus, Loader2, Megaphone } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { CampaignsTable } from "@/components/marketing/CampaignsTable";
import { CreateCampaignModal } from "@/components/marketing/CreateCampaignModal";
import { CampaignDetailsModal } from "@/components/marketing/CampaignDetailsModal";
import { useCampaigns, useDeleteCampaign, useReopenCampaign } from "@/hooks/useCampaigns";
import type { EmailCampaign } from "@/types/marketing";
import { useLanguage } from "@/i18n";

export default function Campaigns() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<EmailCampaign | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaign | null>(null);
  const { data: campaigns = [], isLoading } = useCampaigns();
  const deleteCampaign = useDeleteCampaign();
  const reopenCampaign = useReopenCampaign();
  const { t } = useLanguage();

  const handleCampaignClick = (campaign: EmailCampaign) => {
    if (campaign.status === 'draft') {
      setEditingCampaign(campaign);
    } else {
      setSelectedCampaign(campaign);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/marketing">
              <Button variant="back" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Megaphone className="h-5 w-5 shrink-0 text-primary" />
                {t("Campanhas")}
              </h1>
              <p className="text-muted-foreground text-sm">{t("Envie emails em massa para os seus clientes")}</p>
            </div>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> {t("Nova Campanha")}
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <CampaignsTable
            campaigns={campaigns}
            onView={handleCampaignClick}
            onEdit={setEditingCampaign}
            onDelete={(id) => deleteCampaign.mutate(id)}
            onReopen={(id) => reopenCampaign.mutate(id)}
          />
        )}

        <CreateCampaignModal open={createOpen} onOpenChange={setCreateOpen} />
        <CreateCampaignModal
          open={!!editingCampaign}
          onOpenChange={(open) => !open && setEditingCampaign(null)}
          campaign={editingCampaign ?? undefined}
        />
        <CampaignDetailsModal
          campaign={selectedCampaign}
          open={!!selectedCampaign}
          onOpenChange={(open) => !open && setSelectedCampaign(null)}
        />
    </div>
  );
}

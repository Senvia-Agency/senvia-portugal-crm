import { Bot } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { OttoWriteAccessTab } from "@/components/settings/OttoWriteAccessTab";
import { usePermissions } from "@/hooks/usePermissions";

export default function OttoWriteAccess() {
  const { isAdmin } = usePermissions();

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        icon={Bot}
        title="Permissões do Otto"
        subtitle="Controle a autorização de escrita por módulo na organização ativa."
      />
      <OttoWriteAccessTab canManageOtto={isAdmin} />
    </div>
  );
}

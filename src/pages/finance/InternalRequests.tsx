import { useState } from 'react';
import { usePersistedState } from "@/hooks/usePersistedState";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus } from 'lucide-react';
import { useInternalRequests } from '@/hooks/useInternalRequests';
import { usePermissions } from '@/hooks/usePermissions';
import { RequestsTable } from '@/components/finance/RequestsTable';
import { SubmitRequestModal } from '@/components/finance/SubmitRequestModal';
import { ReviewRequestModal } from '@/components/finance/ReviewRequestModal';
import type { InternalRequest, RequestType, RequestStatus } from '@/types/internal-requests';
import { useLanguage } from '@/i18n';

export default function InternalRequests() {
  const { t } = useLanguage();
  const [filterType, setFilterType] = usePersistedState<RequestType | 'all'>('requests-type-v1', 'all');
  const [filterStatus, setFilterStatus] = usePersistedState<RequestStatus | 'all'>('requests-status-v1', 'all');
  const [showSubmit, setShowSubmit] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<InternalRequest | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filters = {
    ...(filterType !== 'all' && { type: filterType }),
    ...(filterStatus !== 'all' && { status: filterStatus }),
  };

  const { requests, isLoading, deleteRequest, pendingCount } = useInternalRequests(
    Object.keys(filters).length > 0 ? filters as { type?: RequestType; status?: RequestStatus } : undefined
  );
  const { can } = usePermissions();
  const canApprove = can('finance', 'requests', 'approve');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("Pedidos Internos")}</h2>
          {canApprove && pendingCount > 0 && (
            <p className="text-sm text-muted-foreground">{t("{{n}} pedido(s) pendente(s)", { n: pendingCount })}</p>
          )}
        </div>
        <Button size="sm" onClick={() => setShowSubmit(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> {t("Novo Pedido")}
        </Button>
      </div>

      <RequestsTable
        requests={requests}
        isLoading={isLoading}
        onSelect={setSelectedRequest}
        onDelete={(id) => setDeleteId(id)}
        filterType={filterType}
        filterStatus={filterStatus}
        onFilterType={setFilterType}
        onFilterStatus={setFilterStatus}
      />

      <SubmitRequestModal open={showSubmit} onOpenChange={setShowSubmit} />
      <ReviewRequestModal
        request={selectedRequest}
        open={!!selectedRequest}
        onOpenChange={(open) => !open && setSelectedRequest(null)}
        canApprove={canApprove}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Apagar pedido?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Esta ação é irreversível. O pedido será permanentemente removido.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) deleteRequest.mutate(deleteId);
                setDeleteId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("Apagar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

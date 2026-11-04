import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/format';
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS, REQUEST_STATUS_COLORS } from '@/types/internal-requests';
import type { InternalRequest, RequestType, RequestStatus } from '@/types/internal-requests';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/i18n';

interface Props {
  requests: InternalRequest[];
  isLoading: boolean;
  onSelect: (r: InternalRequest) => void;
  onDelete: (id: string) => void;
  filterType: RequestType | 'all';
  filterStatus: RequestStatus | 'all';
  onFilterType: (v: RequestType | 'all') => void;
  onFilterStatus: (v: RequestStatus | 'all') => void;
}

export function RequestsTable({ requests, isLoading, onSelect, onDelete, filterType, filterStatus, onFilterType, onFilterStatus }: Props) {
  const { session } = useAuth();
  const { t } = useLanguage();

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Select value={filterType} onValueChange={(v) => onFilterType(v as RequestType | 'all')}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder={t("Tipo")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Todos os tipos")}</SelectItem>
            <SelectItem value="expense">{t("Despesa")}</SelectItem>
            <SelectItem value="vacation">{t("Férias")}</SelectItem>
            <SelectItem value="invoice">{t("Fatura")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => onFilterStatus(v as RequestStatus | 'all')}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder={t("Estado")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Todos os estados")}</SelectItem>
            <SelectItem value="pending">{t("Pendente")}</SelectItem>
            <SelectItem value="approved">{t("Aprovado")}</SelectItem>
            <SelectItem value="paid">{t("Pago")}</SelectItem>
            <SelectItem value="rejected">{t("Rejeitado")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <p className="text-sm">{t("Nenhum pedido encontrado")}</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Data")}</TableHead>
                <TableHead>{t("Tipo")}</TableHead>
                <TableHead>{t("Título")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("Submetido por")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("Valor")}</TableHead>
                <TableHead>{t("Estado")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelect(r)}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.submitted_at)}</TableCell>
                  <TableCell className="text-xs">{t(REQUEST_TYPE_LABELS[r.request_type])}</TableCell>
                  <TableCell className="font-medium max-w-[200px] truncate">{r.title}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{r.submitter?.full_name || '—'}</TableCell>
                  <TableCell className="hidden sm:table-cell">{r.amount != null ? formatCurrency(r.amount) : '-'}</TableCell>
                  <TableCell>
                    <Badge className={REQUEST_STATUS_COLORS[r.status]} variant="secondary">
                      {t(REQUEST_STATUS_LABELS[r.status])}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.status === 'pending' && r.submitted_by === session?.user.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => { e.stopPropagation(); onDelete(r.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

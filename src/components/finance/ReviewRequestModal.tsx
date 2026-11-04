import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useInternalRequests } from '@/hooks/useInternalRequests';
import { formatCurrency, formatDate } from '@/lib/format';
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS, REQUEST_STATUS_COLORS } from '@/types/internal-requests';
import type { InternalRequest } from '@/types/internal-requests';
import { useLanguage } from '@/i18n';

interface Props {
  request: InternalRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canApprove: boolean;
}

export function ReviewRequestModal({ request, open, onOpenChange, canApprove }: Props) {
  const { reviewRequest } = useInternalRequests();
  const { t } = useLanguage();
  const [notes, setNotes] = useState('');
  const [paymentRef, setPaymentRef] = useState('');

  if (!request) return null;

  const isPending = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const canReview = canApprove && (isPending || isApproved);

  const handleAction = async (status: 'approved' | 'rejected' | 'paid') => {
    await reviewRequest.mutateAsync({
      id: request.id,
      status,
      review_notes: notes || undefined,
      payment_reference: paymentRef || undefined,
    });
    setNotes('');
    setPaymentRef('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {request.title}
            <Badge className={REQUEST_STATUS_COLORS[request.status]}>
              {t(REQUEST_STATUS_LABELS[request.status])}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {request.submitter?.full_name && (
              <div className="col-span-2">
                <span className="text-muted-foreground">{t("Submetido por:")}</span>
                <p className="font-medium">{request.submitter.full_name}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">{t("Tipo:")}</span>
              <p className="font-medium">{t(REQUEST_TYPE_LABELS[request.request_type])}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("Data de submissão:")}</span>
              <p className="font-medium">{formatDate(request.submitted_at)}</p>
            </div>
            {request.amount != null && (
              <div>
                <span className="text-muted-foreground">{t("Valor:")}</span>
                <p className="font-medium">{formatCurrency(request.amount)}</p>
              </div>
            )}
            {request.expense_date && (
              <div>
                <span className="text-muted-foreground">{t("Data da despesa:")}</span>
                <p className="font-medium">{formatDate(request.expense_date)}</p>
              </div>
            )}
            {request.period_start && (
              <div>
                <span className="text-muted-foreground">{t("Período:")}</span>
                <p className="font-medium">{formatDate(request.period_start)} — {request.period_end ? formatDate(request.period_end) : '...'}</p>
              </div>
            )}
          </div>

          {request.description && (
            <div>
              <span className="text-sm text-muted-foreground">{t("Descrição:")}</span>
              <p className="mt-1 text-sm whitespace-pre-wrap">{request.description}</p>
            </div>
          )}

          {request.file_url && (
            <div>
              <a href={request.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <ExternalLink className="h-4 w-4" /> {t("Ver ficheiro anexo")}
              </a>
            </div>
          )}

          {request.review_notes && (
            <div className="rounded-lg border p-3">
              <span className="text-xs font-medium text-muted-foreground">{t("Notas de revisão:")}</span>
              <p className="mt-1 text-sm">{request.review_notes}</p>
            </div>
          )}

          {request.payment_reference && (
            <div className="rounded-lg border p-3">
              <span className="text-xs font-medium text-muted-foreground">{t("Referência de pagamento:")}</span>
              <p className="mt-1 text-sm">{request.payment_reference}</p>
            </div>
          )}

          {canReview && (
            <>
              <div className="space-y-2">
                <Label htmlFor="reviewNotes">{t("Notas de revisão")}</Label>
                <Textarea id="reviewNotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Observações...")} rows={2} />
              </div>

              {isApproved && (
                <div className="space-y-2">
                  <Label htmlFor="paymentRef">{t("Referência de pagamento")}</Label>
                  <Input id="paymentRef" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder={t("Ex: TRF-12345")} />
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                {isPending && (
                  <>
                    <Button onClick={() => handleAction('approved')} disabled={reviewRequest.isPending}>
                      {reviewRequest.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {t("Aprovar")}
                    </Button>
                    <Button variant="destructive" onClick={() => handleAction('rejected')} disabled={reviewRequest.isPending}>
                      {t("Rejeitar")}
                    </Button>
                  </>
                )}
                {isApproved && (
                  <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handleAction('paid')} disabled={reviewRequest.isPending}>
                    {reviewRequest.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("Marcar como Pago")}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

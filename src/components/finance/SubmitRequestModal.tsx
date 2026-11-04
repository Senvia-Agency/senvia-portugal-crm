import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Wallet, CalendarDays, FileText, Upload, Loader2 } from 'lucide-react';
import type { RequestType } from '@/types/internal-requests';
import { useInternalRequests } from '@/hooks/useInternalRequests';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPE_OPTIONS: { value: RequestType; label: string; icon: typeof Wallet }[] = [
  { value: 'expense', label: 'Despesa', icon: Wallet },
  { value: 'vacation', label: 'Férias', icon: CalendarDays },
  { value: 'invoice', label: 'Fatura', icon: FileText },
];

export function SubmitRequestModal({ open, onOpenChange }: Props) {
  const { submitRequest, uploadFile } = useInternalRequests();
  const { t } = useLanguage();
  const [type, setType] = useState<RequestType>('expense');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setType('expense');
    setTitle('');
    setDescription('');
    setAmount('');
    setExpenseDate('');
    setPeriodStart('');
    setPeriodEnd('');
    setFile(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    try {
      let fileUrl: string | undefined;
      if (file) {
        fileUrl = await uploadFile(file);
      }
      await submitRequest.mutateAsync({
        request_type: type,
        title,
        description: description || undefined,
        amount: amount ? parseFloat(amount) : undefined,
        expense_date: expenseDate || undefined,
        period_start: periodStart || undefined,
        period_end: periodEnd || undefined,
        file_url: fileUrl,
      });
      reset();
      onOpenChange(false);
    } finally {
      setUploading(false);
    }
  };

  const showAmount = type === 'expense' || type === 'invoice';
  const showExpenseDate = type === 'expense' || type === 'invoice';
  const showPeriod = type === 'vacation';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Novo Pedido")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Type selector */}
          <div className="space-y-2">
            <Label>{t("Tipo de Pedido")}</Label>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setType(opt.value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors',
                      type === opt.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-muted'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {t(opt.label)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">{t("Título *")}</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={t("Ex: Combustível Janeiro")} />
          </div>

          {showAmount && (
            <div className="space-y-2">
              <Label htmlFor="amount">{t("Valor (€)")}</Label>
              <Input id="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
          )}

          {showExpenseDate && (
            <div className="space-y-2">
              <Label htmlFor="expenseDate">{t("Data")}</Label>
              <Input id="expenseDate" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          )}

          {showPeriod && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="periodStart">{t("Início")}</Label>
                <Input id="periodStart" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="periodEnd">{t("Fim")}</Label>
                <Input id="periodEnd" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">{t("Descrição")}</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Detalhes adicionais...")} rows={3} />
          </div>

          <div className="space-y-2">
            <Label>{t("Anexo (PDF, Excel, Imagem)")}</Label>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-4 text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-muted/50">
              <Upload className="h-5 w-5" />
              {file ? file.name : t('Clique para anexar ficheiro')}
              <input type="file" className="hidden" accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button>
            <Button type="submit" disabled={!title || uploading || submitRequest.isPending}>
              {(uploading || submitRequest.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("Submeter")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { CalendarClock, Landmark } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { DATE_BASIS_LABEL, type DateBasis } from '@/lib/recurring-finance';
import { useLanguage } from '@/i18n';

interface FinanceDateBasisSelectProps {
  value: DateBasis;
  onChange: (value: DateBasis) => void;
}

/**
 * Alterna entre competência e recebimento.
 *
 * Existe porque as duas leituras são legítimas e respondem a perguntas
 * diferentes: "quanto faturei em junho" e "quanto me entrou em junho" dão
 * números diferentes sempre que um pagamento atravessa a fronteira do mês.
 * Antes havia só uma data e o utilizador não sabia qual das perguntas estava a
 * ver respondida.
 */
export function FinanceDateBasisSelect({ value, onChange }: FinanceDateBasisSelectProps) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{t("Base de cálculo")}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as DateBasis)}>
        <SelectTrigger className="w-[190px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="accrual">
            <span className="flex items-center gap-2">
              <CalendarClock className="h-3.5 w-3.5" />
              {t(DATE_BASIS_LABEL.accrual)}
            </span>
          </SelectItem>
          <SelectItem value="cash">
            <span className="flex items-center gap-2">
              <Landmark className="h-3.5 w-3.5" />
              {t(DATE_BASIS_LABEL.cash)}
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        {value === 'accrual'
          ? t('O mês que o serviço cobre, esteja pago ou não.')
          : t('O mês em que o dinheiro entrou.')}
      </p>
    </div>
  );
}

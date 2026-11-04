import { FileText, FileSignature } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/i18n';

interface SimpleCheckboxFieldProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Unique-enough id (this component can render more than once per page). */
  id: string;
}

/** Single "Documentos entregues?" tick for a sale/proposal — plain true/false, nothing to configure. */
export function DocumentsCheckboxField({ checked, onChange, id }: SimpleCheckboxFieldProps) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="flex items-center gap-1.5 text-sm font-normal cursor-pointer">
        <FileText className="h-3.5 w-3.5" /> {t("Documentos entregues")}
      </Label>
    </div>
  );
}

/** Single "Contrato assinado?" tick for a sale/proposal — plain true/false, nothing to configure. */
export function ContractSignedCheckboxField({ checked, onChange, id }: SimpleCheckboxFieldProps) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="flex items-center gap-1.5 text-sm font-normal cursor-pointer">
        <FileSignature className="h-3.5 w-3.5" /> {t("Contrato assinado")}
      </Label>
    </div>
  );
}

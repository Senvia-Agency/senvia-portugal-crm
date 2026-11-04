import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSwitchComercializador } from '@/hooks/useCpes';
import { COMERCIALIZADORES, ENERGY_COMERCIALIZADORES } from '@/types/cpes';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from "@/i18n";

interface SwitchComercializadorModalProps {
  cpeId: string;
  currentComercializador: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SwitchComercializadorModal({ cpeId, currentComercializador, open, onOpenChange }: SwitchComercializadorModalProps) {
  const { t } = useLanguage();
  const switchCom = useSwitchComercializador();
  const { organization } = useAuth();
  const isTelecom = organization?.niche === 'telecom';

  const [comercializador, setComercializador] = useState('');
  const [customComercializador, setCustomComercializador] = useState('');
  const [fidelizacaoStart, setFidelizacaoStart] = useState('');
  const [fidelizacaoEnd, setFidelizacaoEnd] = useState('');

  const comercializadorOptions = isTelecom ? ENERGY_COMERCIALIZADORES : COMERCIALIZADORES;
  const finalComercializador = comercializador === 'Outro' ? customComercializador : comercializador;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalComercializador || !fidelizacaoEnd) return;

    switchCom.mutate(
      { id: cpeId, comercializador: finalComercializador, fidelizacao_end: fidelizacaoEnd, fidelizacao_start: fidelizacaoStart || undefined },
      { onSuccess: () => { onOpenChange(false); setComercializador(''); setCustomComercializador(''); setFidelizacaoEnd(''); setFidelizacaoStart(''); } }
    );
  };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Alterar Comercializador")}</DialogTitle>
          <DialogDescription>
            {t("Atual: {{name}}. A nova data de fim de fidelização é obrigatória.", { name: currentComercializador })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Novo Comercializador *")}</Label>
            <Select value={comercializador} onValueChange={setComercializador}>
              <SelectTrigger>
                <SelectValue placeholder={t("Selecione")} />
              </SelectTrigger>
              <SelectContent>
                {comercializadorOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {comercializador === 'Outro' && (
              <Input placeholder={t("Nome do comercializador")} value={customComercializador} onChange={(e) => setCustomComercializador(e.target.value)} />
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("Novo Início (opcional)")}</Label>
            <Input type="date" value={fidelizacaoStart} onChange={(e) => setFidelizacaoStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("Nova Data Fim Fidelização *")}</Label>
            <Input type="date" value={fidelizacaoEnd} onChange={(e) => setFidelizacaoEnd(e.target.value)} min={minDate} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button>
            <Button type="submit" disabled={!finalComercializador || !fidelizacaoEnd || switchCom.isPending}>
              {switchCom.isPending ? t("A guardar...") : t("Confirmar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

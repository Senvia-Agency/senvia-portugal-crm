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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateCpe } from '@/hooks/useCpes';
import { EQUIPMENT_TYPES, COMERCIALIZADORES, ENERGY_TYPES, ENERGY_COMERCIALIZADORES, NIVEL_TENSAO_OPTIONS, type CpeStatus, type NivelTensao } from '@/types/cpes';
import { useLanguage } from "@/i18n";

interface CreateCpeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  isTelecom?: boolean;
}

export function CreateCpeModal({ open, onOpenChange, clientId, isTelecom = false }: CreateCpeModalProps) {
  const { t } = useLanguage();
  const createCpe = useCreateCpe();
  
  const [equipmentType, setEquipmentType] = useState('');
  const [customEquipmentType, setCustomEquipmentType] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [comercializador, setComercializador] = useState('');
  const [customComercializador, setCustomComercializador] = useState('');
  const [fidelizacaoStart, setFidelizacaoStart] = useState('');
  const [fidelizacaoEnd, setFidelizacaoEnd] = useState('');
  const [status, setStatus] = useState<CpeStatus>('active');
  const [nivelTensao, setNivelTensao] = useState<NivelTensao | ''>('');
  const [notes, setNotes] = useState('');
  const [consumoAnual, setConsumoAnual] = useState('');

  // Conditional labels and options based on niche
  const typeLabel = isTelecom ? t("Tipo *") : t("Tipo de Equipamento *");
  const serialLabel = isTelecom ? t("Local de Consumo (CPE/CUI)") : t("Número de Série");
  const serialPlaceholder = isTelecom ? t("Ex: PT0002000012345678XX") : t("Ex: SN123456789");
  const typeOptions = isTelecom ? ENERGY_TYPES : EQUIPMENT_TYPES;
  const comercializadorOptions = isTelecom ? ENERGY_COMERCIALIZADORES : COMERCIALIZADORES;
  const modalTitle = isTelecom ? t("Adicionar CPE/CUI") : t("Adicionar CPE");
  const modalDescription = isTelecom 
    ? t("Registe um novo ponto de consumo para este cliente.") 
    : t("Registe um novo equipamento para este cliente.");

  const resetForm = () => {
    setEquipmentType('');
    setCustomEquipmentType('');
    setSerialNumber('');
    setComercializador('');
    setCustomComercializador('');
    setFidelizacaoStart('');
    setFidelizacaoEnd('');
    setStatus('active');
    setNivelTensao('');
    setNotes('');
    setConsumoAnual('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const finalEquipmentType = equipmentType === 'Outro' ? customEquipmentType : equipmentType;
    const finalComercializador = comercializador === 'Outro' ? customComercializador : comercializador;

    if (!finalEquipmentType || !finalComercializador) return;

    createCpe.mutate({
      client_id: clientId,
      equipment_type: finalEquipmentType,
      serial_number: serialNumber || undefined,
      comercializador: finalComercializador,
      fidelizacao_start: fidelizacaoStart || undefined,
      fidelizacao_end: fidelizacaoEnd || undefined,
      status,
      nivel_tensao: isTelecom && nivelTensao ? nivelTensao : undefined,
      notes: notes || undefined,
      consumo_anual: consumoAnual ? parseFloat(consumoAnual) : undefined,
    }, {
      onSuccess: () => {
        resetForm();
        onOpenChange(false);
      }
    });
  };

  const isValid = (equipmentType === 'Outro' ? customEquipmentType : equipmentType) && 
                  (comercializador === 'Outro' ? customComercializador : comercializador);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{modalTitle}</DialogTitle>
          <DialogDescription>
            {modalDescription}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Equipment Type */}
          <div className="space-y-2">
            <Label>{typeLabel}</Label>
            <Select value={equipmentType} onValueChange={setEquipmentType}>
              <SelectTrigger>
                <SelectValue placeholder={t("Selecione o tipo")} />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((type) => (
                  <SelectItem key={type} value={type}>{t(type)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {equipmentType === 'Outro' && (
              <Input
                placeholder={t("Especifique o tipo")}
                value={customEquipmentType}
                onChange={(e) => setCustomEquipmentType(e.target.value)}
              />
            )}
          </div>

          {/* Serial Number / CPE-CUI */}
          <div className="space-y-2">
            <Label>{serialLabel}</Label>
            <Input
              placeholder={serialPlaceholder}
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
            />
          </div>

          {/* Comercializador */}
          <div className="space-y-2">
            <Label>{t("Comercializador *")}</Label>
            <Select value={comercializador} onValueChange={setComercializador}>
              <SelectTrigger>
                <SelectValue placeholder={t("Selecione o comercializador")} />
              </SelectTrigger>
              <SelectContent>
                {comercializadorOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {comercializador === 'Outro' && (
              <Input
                placeholder={t("Nome do comercializador")}
                value={customComercializador}
                onChange={(e) => setCustomComercializador(e.target.value)}
              />
            )}
          </div>

          {/* Fidelização */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("Início Fidelização")}</Label>
              <Input
                type="date"
                value={fidelizacaoStart}
                onChange={(e) => setFidelizacaoStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Fim Fidelização")}</Label>
              <Input
                type="date"
                value={fidelizacaoEnd}
                onChange={(e) => setFidelizacaoEnd(e.target.value)}
              />
            </div>
          </div>

          {/* Status or Nivel Tensão */}
          {isTelecom ? (
            <div className="space-y-2">
              <Label>{t("Nível Tensão")}</Label>
              <Select value={nivelTensao} onValueChange={(v) => setNivelTensao(v as NivelTensao)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("Selecione o nível")} />
                </SelectTrigger>
                <SelectContent>
                  {NIVEL_TENSAO_OPTIONS.map((nt) => (
                    <SelectItem key={nt} value={nt}>{nt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>{t("Estado")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as CpeStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("Ativo")}</SelectItem>
                  <SelectItem value="pending">{t("Pendente")}</SelectItem>
                  <SelectItem value="inactive">{t("Inativo")}</SelectItem>
                  <SelectItem value="returned">{t("Devolvido")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Consumo Anual - only for telecom/energy */}
          {isTelecom && (
            <div className="space-y-2">
              <Label>{t("Consumo Anual (kWh)")}</Label>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t("Ex: 3500")}
                  value={consumoAnual}
                  onChange={(e) => setConsumoAnual(e.target.value)}
                  className="pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t("kWh")}</span>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>{t("Notas")}</Label>
            <Textarea
              placeholder={t("Observações sobre o equipamento...")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={!isValid || createCpe.isPending}>
              {createCpe.isPending ? t("A guardar...") : t("Adicionar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

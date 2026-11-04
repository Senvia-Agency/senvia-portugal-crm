import { useState, useEffect, useMemo } from 'react';
import { Plus, X, Zap, Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useCpes } from '@/hooks/useCpes';
import { ENERGY_COMERCIALIZADORES } from '@/types/cpes';
import { useCommissionMatrix, getVolumeTier } from '@/hooks/useCommissionMatrix';
import { useLanguage } from "@/i18n";

export interface ProposalCpeDraft {
  id: string;
  existing_cpe_id: string | null;
  equipment_type: string;
  serial_number: string;
  comercializador: string;
  fidelizacao_start: string;
  fidelizacao_end: string;
  notes: string;
  isNew: boolean;
  // Dados de energia por CPE
  consumo_anual: string;
  duracao_contrato: string;
  dbl: string;
  margem: string;
  comissao: string;
  contrato_inicio: string;
  contrato_fim: string;
}

interface ProposalCpeSelectorProps {
  clientId: string | null;
  cpes: ProposalCpeDraft[];
  onCpesChange: (cpes: ProposalCpeDraft[]) => void;
}

// Calcula margem: consumo × duração × DBL / 1000
function calculateMargem(consumo: string, duracao: string, dbl: string): string {
  const c = parseFloat(consumo) || 0;
  const d = parseFloat(duracao) || 0;
  const db = parseFloat(dbl) || 0;
  if (c > 0 && d > 0 && db > 0) {
    return ((c * d * db) / 1000).toFixed(2);
  }
  return '';
}

export function ProposalCpeSelector({ clientId, cpes, onCpesChange }: ProposalCpeSelectorProps) {
  const { t } = useLanguage();
  const { data: clientCpes = [] } = useCpes(clientId);
  const { calculateEnergyCommission, hasEnergyConfig } = useCommissionMatrix();
  
  const comercializadorOptions = ENERGY_COMERCIALIZADORES;
  
  // State for existing CPE selection form
  const [selectedExistingCpe, setSelectedExistingCpe] = useState<string | null>(null);
  const [updateConsumoAnual, setUpdateConsumoAnual] = useState('');
  const [updateDuracaoContrato, setUpdateDuracaoContrato] = useState('');
  const [updateDbl, setUpdateDbl] = useState('');
  const [updateComissao, setUpdateComissao] = useState('');
  const [updateContratoInicio, setUpdateContratoInicio] = useState('');
  const [updateContratoFim, setUpdateContratoFim] = useState('');
  const [updateComercializador, setUpdateComercializador] = useState('');
  const [updateCustomComercializador, setUpdateCustomComercializador] = useState('');

  // Auto-calculate margem for existing CPE
  const updateMargem = useMemo(() => 
    calculateMargem(updateConsumoAnual, updateDuracaoContrato, updateDbl), 
    [updateConsumoAnual, updateDuracaoContrato, updateDbl]
  );

  // Auto-calculate commission from energy config
  const updateAutoComissao = useMemo(() => {
    if (!hasEnergyConfig || !updateMargem) return null;
    const margem = parseFloat(updateMargem);
    if (margem <= 0) return null;
    return calculateEnergyCommission(margem, getVolumeTier(parseFloat(updateConsumoAnual) || 0));
  }, [updateMargem, hasEnergyConfig, calculateEnergyCommission]);

  // When auto-commission changes, update the field
  useEffect(() => {
    if (updateAutoComissao !== null) {
      setUpdateComissao(updateAutoComissao.toFixed(2));
    }
  }, [updateAutoComissao]);

  // Auto-calculate duracao when dates change
  useEffect(() => {
    if (updateContratoInicio && updateContratoFim) {
      const start = new Date(updateContratoInicio);
      const end = new Date(updateContratoFim);
      const days = (end.getTime() - start.getTime()) / 86400000;
      if (days > 0) {
        setUpdateDuracaoContrato((days / 365).toFixed(3));
      } else {
        setUpdateDuracaoContrato('');
      }
    } else {
      setUpdateDuracaoContrato('');
    }
  }, [updateContratoInicio, updateContratoFim]);

  const resetForm = () => {
    setSelectedExistingCpe(null);
    setUpdateConsumoAnual('');
    setUpdateDuracaoContrato('');
    setUpdateDbl('');
    setUpdateComissao('');
    setUpdateContratoInicio('');
    setUpdateContratoFim('');
    setUpdateComercializador('');
    setUpdateCustomComercializador('');
  };

  const handleAddExistingCpe = () => {
    if (!selectedExistingCpe) return;
    
    const existingCpe = clientCpes.find(c => c.id === selectedExistingCpe);
    if (!existingCpe) return;

    // Check if already added
    if (cpes.find(c => c.existing_cpe_id === selectedExistingCpe)) {
      return;
    }

    const finalComercializador = updateComercializador === 'other' 
      ? updateCustomComercializador 
      : (updateComercializador === 'keep_current' || !updateComercializador ? existingCpe.comercializador : updateComercializador);

    const newCpe: ProposalCpeDraft = {
      id: crypto.randomUUID(),
      existing_cpe_id: existingCpe.id,
      equipment_type: existingCpe.equipment_type,
      serial_number: existingCpe.serial_number || '',
      comercializador: finalComercializador,
      fidelizacao_start: updateContratoInicio || existingCpe.fidelizacao_start || '',
      fidelizacao_end: updateContratoFim || existingCpe.fidelizacao_end || '',
      notes: '',
      isNew: false,
      consumo_anual: updateConsumoAnual,
      duracao_contrato: updateDuracaoContrato,
      dbl: updateDbl,
      margem: updateMargem,
      comissao: updateComissao,
      contrato_inicio: updateContratoInicio,
      contrato_fim: updateContratoFim,
    };

    onCpesChange([...cpes, newCpe]);
    resetForm();
  };

  const handleRemoveCpe = (id: string) => {
    onCpesChange(cpes.filter(c => c.id !== id));
  };

  const handleUpdateCpeField = (id: string, field: keyof ProposalCpeDraft, value: string) => {
    onCpesChange(cpes.map(cpe => {
      if (cpe.id !== id) return cpe;
      const updated = { ...cpe, [field]: value };
      // Auto-recalculate margem when relevant fields change
      if (['consumo_anual', 'duracao_contrato', 'dbl'].includes(field)) {
        updated.margem = calculateMargem(updated.consumo_anual, updated.duracao_contrato, updated.dbl);
        // Auto-calculate commission from energy config
        if (hasEnergyConfig && updated.margem) {
          const margem = parseFloat(updated.margem);
          if (margem > 0) {
            const com = calculateEnergyCommission(margem, getVolumeTier(parseFloat(updated.consumo_anual) || 0));
            if (com !== null) updated.comissao = com.toFixed(2);
          }
        }
      }
      // Auto-recalculate duracao_contrato when dates change
      if ((field === 'contrato_inicio' || field === 'contrato_fim') && updated.contrato_inicio && updated.contrato_fim) {
        const start = new Date(updated.contrato_inicio);
        const end = new Date(updated.contrato_fim);
        const days = (end.getTime() - start.getTime()) / 86400000;
        if (days > 0) {
          updated.duracao_contrato = (days / 365).toFixed(3);
          updated.margem = calculateMargem(updated.consumo_anual, updated.duracao_contrato, updated.dbl);
          // Auto-calculate commission
          if (hasEnergyConfig && updated.margem) {
            const margem = parseFloat(updated.margem);
            if (margem > 0) {
              const com = calculateEnergyCommission(margem, getVolumeTier(parseFloat(updated.consumo_anual) || 0));
              if (com !== null) updated.comissao = com.toFixed(2);
            }
          }
        }
      }
      return updated;
    }));
  };

  // Filter out already selected CPEs from the list
  const availableExistingCpes = clientCpes.filter(
    cpe => !cpes.find(c => c.existing_cpe_id === cpe.id)
  );

  const hasValidComercializador = updateComercializador === 'other' 
    ? !!updateCustomComercializador.trim() 
    : (!!updateComercializador && updateComercializador !== '');

  const canAddExisting = selectedExistingCpe !== null
    && !!updateConsumoAnual
    && !!updateDuracaoContrato
    && !!updateDbl
    && !!updateComissao
    && !!updateContratoInicio
    && !!updateContratoFim
    && hasValidComercializador;

  const formatCurrency = (value: string) => {
    const num = parseFloat(value) || 0;
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(num);
  };

  return (
    <div className="space-y-4">
      <Label className="flex items-center gap-2">
        <Zap className="h-4 w-4" />
        {t("CPE/CUI (Pontos de Consumo)")}
      </Label>

      {/* List of added CPEs with energy data */}
      {cpes.length > 0 && (
        <div className="space-y-4">
          {cpes.map((cpe, index) => (
            <div
              key={cpe.id}
              className="p-4 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-600" />
                  <span className="font-medium text-sm">{t("CPE/CUI #{{n}}", { n: index + 1 })}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveCpe(cpe.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              {/* CPE basic info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t("Tipo")}</Label>
                  <Input
                    value={cpe.equipment_type}
                    className="h-8 text-sm"
                    disabled
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("Comercializador")}</Label>
                  <Input
                    value={cpe.comercializador}
                    onChange={(e) => handleUpdateCpeField(cpe.id, 'comercializador', e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("CPE/CUI")}</Label>
                  <Input
                    value={cpe.serial_number}
                    onChange={(e) => handleUpdateCpeField(cpe.id, 'serial_number', e.target.value)}
                    className="h-8 text-sm"
                    placeholder={t("PT0002...")}
                  />
                </div>
              </div>

              <Separator className="my-3" />
              
              {/* Energy data per CPE */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">{t("Consumo Anual (kWh)")}</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={cpe.consumo_anual}
                    onChange={(e) => handleUpdateCpeField(cpe.id, 'consumo_anual', e.target.value)}
                    className="h-8 text-sm"
                    placeholder="15000"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("Início Contrato")}</Label>
                  <Input
                    type="date"
                    value={cpe.contrato_inicio}
                    onChange={(e) => handleUpdateCpeField(cpe.id, 'contrato_inicio', e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("Fim Contrato")}</Label>
                  <Input
                    type="date"
                    value={cpe.contrato_fim}
                    onChange={(e) => handleUpdateCpeField(cpe.id, 'contrato_fim', e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("DBL (€/MWh)")}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cpe.dbl}
                    onChange={(e) => handleUpdateCpeField(cpe.id, 'dbl', e.target.value)}
                    className="h-8 text-sm"
                    placeholder="5.50"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    <Calculator className="h-3 w-3" />
                    {t("Duração (anos)")}
                  </Label>
                  <Input
                    value={cpe.duracao_contrato}
                    className="h-8 text-sm bg-muted font-medium"
                    disabled
                    placeholder={t("Auto")}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    <Calculator className="h-3 w-3" />
                    {t("Margem (€)")}
                  </Label>
                  <Input
                    value={cpe.margem}
                    className="h-8 text-sm bg-muted font-medium"
                    disabled
                    placeholder={t("Auto")}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    {t("Comissão (€)")}
                    {hasEnergyConfig && <Badge variant="outline" className="text-[9px] ml-1">{t("Auto")}</Badge>}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cpe.comissao}
                    onChange={(e) => handleUpdateCpeField(cpe.id, 'comissao', e.target.value)}
                    className={`h-8 text-sm ${hasEnergyConfig ? 'bg-muted' : ''}`}
                    readOnly={hasEnergyConfig}
                    placeholder="150"
                  />
                </div>
              </div>

              {/* Summary */}
              {cpe.margem && parseFloat(cpe.margem) > 0 && (
                <div className="mt-3 p-2 bg-amber-100 dark:bg-amber-900/30 rounded text-xs text-amber-800 dark:text-amber-200">
                  {t("Margem calculada:")} <strong>{formatCurrency(cpe.margem)}</strong>
                  {cpe.comissao && ` | ${t("Comissão:")} ${formatCurrency(cpe.comissao)}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add CPE from existing client CPEs */}
      <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
        <Label className="text-sm font-medium">{t("Selecionar CPE/CUI do Cliente")}</Label>
        
        {!clientId ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("Selecione um cliente para ver os CPEs existentes")}
          </p>
        ) : clientCpes.length === 0 ? (
          <div className="text-center py-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("Este cliente não tem CPEs registados.")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("Adicione primeiro os pontos de consumo na ficha do cliente.")}
            </p>
          </div>
        ) : availableExistingCpes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("Todos os CPEs deste cliente já foram adicionados à proposta.")}
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <Select value={selectedExistingCpe || ''} onValueChange={setSelectedExistingCpe}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("Selecionar CPE existente...")} />
                </SelectTrigger>
                <SelectContent>
                  {availableExistingCpes.map((cpe) => (
                    <SelectItem key={cpe.id} value={cpe.id}>
                      {cpe.equipment_type} - {cpe.comercializador}
                      {cpe.serial_number && ` (${cpe.serial_number})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedExistingCpe && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("Novo Comercializador")} <span className="text-destructive">*</span></Label>
                    <Select value={updateComercializador} onValueChange={setUpdateComercializador}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={t("Manter atual...")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="keep_current">{t("Manter atual")}</SelectItem>
                        {comercializadorOptions.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                        <SelectItem value="other">{t("Outro...")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {updateComercializador === 'other' && (
                      <Input
                        placeholder={t("Comercializador...")}
                        value={updateCustomComercializador}
                        onChange={(e) => setUpdateCustomComercializador(e.target.value)}
                        className="h-8 mt-1"
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("Início Contrato")} <span className="text-destructive">*</span></Label>
                    <Input
                      type="date"
                      value={updateContratoInicio}
                      onChange={(e) => setUpdateContratoInicio(e.target.value)}
                      className="h-9"
                    />
                  </div>
                   <div className="space-y-1">
                    <Label className="text-xs">{t("Fim Contrato")} <span className="text-destructive">*</span></Label>
                    <Input
                      type="date"
                      value={updateContratoFim}
                      onChange={(e) => setUpdateContratoFim(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>

                <Separator />

                {/* Energy fields */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("Consumo Anual (kWh)")} <span className="text-destructive">*</span></Label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={updateConsumoAnual}
                      onChange={(e) => setUpdateConsumoAnual(e.target.value)}
                      className="h-8"
                      placeholder="15000"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("DBL (€/MWh)")} <span className="text-destructive">*</span></Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={updateDbl}
                      onChange={(e) => setUpdateDbl(e.target.value)}
                      className="h-8"
                      placeholder="5.50"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      <Calculator className="h-3 w-3" />
                      {t("Duração (anos)")}
                    </Label>
                    <Input
                      value={updateDuracaoContrato}
                      className="h-8 bg-muted font-medium"
                      disabled
                      placeholder={t("Auto")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      <Calculator className="h-3 w-3" />
                      {t("Margem (€)")}
                    </Label>
                    <Input
                      value={updateMargem}
                      className="h-8 bg-muted font-medium"
                      disabled
                      placeholder={t("Auto")}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    {t("Comissão (€)")} <span className="text-destructive">*</span>
                    {hasEnergyConfig && <Badge variant="outline" className="text-[9px] ml-1">{t("Auto")}</Badge>}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={updateComissao}
                    onChange={(e) => setUpdateComissao(e.target.value)}
                    className={`h-8 w-full sm:w-1/3 ${hasEnergyConfig ? 'bg-muted' : ''}`}
                    readOnly={hasEnergyConfig}
                    placeholder="150"
                  />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddExistingCpe}
                  disabled={!canAddExisting}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t("Adicionar à Proposta")}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

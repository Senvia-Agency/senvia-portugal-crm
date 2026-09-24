import { useState, useMemo, useEffect, useRef } from 'react';
import { X, UserPlus, Zap, Wrench, Package, FileText, User, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableCombobox, type ComboboxOption } from '@/components/ui/searchable-combobox';
import { Separator } from '@/components/ui/separator';


import { Checkbox } from '@/components/ui/checkbox';
import { useUpdateProposal, useProposalProducts, useUpdateProposalProducts } from '@/hooks/useProposals';
import { useModules } from '@/hooks/useModules';
import { useClients } from '@/hooks/useClients';
import { useActiveProducts } from '@/hooks/useProducts';
import { useAuth } from '@/contexts/AuthContext';
import { useCommissionMatrix, getVolumeTier } from '@/hooks/useCommissionMatrix';
import { CreateClientModal } from '@/components/clients/CreateClientModal';
import { ProposalCpeSelector, type ProposalCpeDraft } from './ProposalCpeSelector';
import { useProposalCpes, useUpdateProposalCpes } from '@/hooks/useProposalCpes';
import { 
  PROPOSAL_STATUS_LABELS, 
  PROPOSAL_STATUSES, 
  NEGOTIATION_TYPE_LABELS,
  NEGOTIATION_TYPES,
  FIELD_LABELS,
  type ServicosDetails,
  type ProposalStatus, 
  type ProposalType,
  type ModeloServico,
  type NegotiationType,
  type Proposal,
  getCatalogCommission,
} from '@/types/proposals';
import { useServicosProducts } from '@/hooks/useServicosProducts';
import { ServicosSection } from '@/components/proposals/ServicosSection';
import { DocumentsCheckboxField, ContractSignedCheckboxField } from '@/components/shared/DocumentsCheckboxField';

interface EditProposalModalProps {
  proposal: Proposal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function EditProposalModal({ proposal, open, onOpenChange, onSuccess }: EditProposalModalProps) {
  const { data: clients = [] } = useClients();
  const { data: products = [] } = useActiveProducts();
  const { data: existingCpes = [], isSuccess: cpesLoaded, isFetching: cpesFetching, isError: cpesError } = useProposalCpes(proposal.id);
  const { data: existingProducts = [], isSuccess: productsLoaded, isFetching: productsFetching, isError: productsError } = useProposalProducts(proposal.id);
  const { organization } = useAuth();
  const { configs: SERVICOS_PRODUCT_CONFIGS, catalog, isNewFormat } = useServicosProducts();
  const { calculateCommission, isAutoCalculated, calculateEnergyCommission, hasEnergyConfig } = useCommissionMatrix();
  const updateProposal = useUpdateProposal();
  const updateProposalCpes = useUpdateProposalCpes();
  const updateProposalProducts = useUpdateProposalProducts();
  
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [proposalDate, setProposalDate] = useState('');
  const [status, setStatus] = useState<ProposalStatus>('draft');
  
  const [negotiationType, setNegotiationType] = useState<NegotiationType | null>(null);
  const [proposalType, setProposalType] = useState<ProposalType>('energia');
  
  const [modeloServico, setModeloServico] = useState<ModeloServico>('transacional');
  const [kwp, setKwp] = useState<string>('');
  const [servicosComissao, setServicosComissao] = useState<string>('');
  const [servicosProdutos, setServicosProdutos] = useState<string[]>([]);
  const [servicosDetails, setServicosDetails] = useState<ServicosDetails>({});
  const [documentsChecked, setDocumentsChecked] = useState(false);
  const [contractSigned, setContractSigned] = useState(false);

  const [proposalCpes, setProposalCpes] = useState<ProposalCpeDraft[]>([]);
  
  const [selectedProducts, setSelectedProducts] = useState<Array<{
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    discount_type: 'percentage' | 'fixed';
    discount_value: number;
  }>>([]);
  const [manualTotal, setManualTotal] = useState('');
  const productsHydratedFor = useRef<string | null>(null);
  const cpesHydratedFor = useRef<string | null>(null);
  
  const [isCreateClientOpen, setIsCreateClientOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open) {
      productsHydratedFor.current = null;
      cpesHydratedFor.current = null;
      return;
    }
    if (proposal) {
      setSelectedClientId(proposal.client_id || null);
      setNotes(proposal.notes || '');
      setProposalDate(proposal.proposal_date?.split('T')[0] || new Date().toISOString().split('T')[0]);
      setStatus(proposal.status);
      setProposalType((proposal.proposal_type as ProposalType) || 'energia');
      setNegotiationType((proposal.negotiation_type as NegotiationType) || null);
      
      setModeloServico((proposal.modelo_servico as ModeloServico) || 'transacional');
      setKwp(proposal.kwp?.toString() || '');
      setServicosComissao(proposal.comissao?.toString() || '');
      setServicosProdutos(proposal.servicos_produtos || []);
      setDocumentsChecked(!!proposal.documents_checked);
      setContractSigned(!!proposal.contract_signed);
      setManualTotal(String(proposal.total_value ?? ''));
      setSelectedProducts([]);
      productsHydratedFor.current = null;
      setProposalCpes([]);
      cpesHydratedFor.current = null;

      // Migrar dados legacy: se servicos_details é null mas tem kwp/comissao no nível superior
      const details = (proposal as any).servicos_details || {};
      if (
        Object.keys(details).length === 0 &&
        proposal.servicos_produtos?.length &&
        proposal.servicos_produtos.length > 0 &&
        (proposal.kwp || proposal.comissao)
      ) {
        const prodName = proposal.servicos_produtos[0];
        details[prodName] = {
          kwp: proposal.kwp || undefined,
          comissao: proposal.comissao || undefined,
        };
      }
      setServicosDetails(details);
      
    }
  }, [open, proposal.id, isTelecom]);

  useEffect(() => {
    if (!open || isTelecom || !productsLoaded || productsFetching
      || productsHydratedFor.current === proposal.id) return;
    setSelectedProducts(existingProducts.map(pp => ({
      product_id: pp.product_id,
      name: pp.product?.name || 'Produto',
      quantity: pp.quantity,
      unit_price: pp.unit_price,
      discount_type: 'percentage' as const,
      discount_value: 0,
    })));
    productsHydratedFor.current = proposal.id;
  }, [open, isTelecom, productsLoaded, productsFetching, proposal.id, existingProducts]);

  // Stable ref to avoid useEffect re-triggering on every render
  const calcRef = useRef(calculateEnergyCommission);
  calcRef.current = calculateEnergyCommission;
  const hasEnergyConfigRef = useRef(hasEnergyConfig);
  hasEnergyConfigRef.current = hasEnergyConfig;

  useEffect(() => {
    if (!open || !cpesLoaded || cpesFetching || cpesHydratedFor.current === proposal.id) return;
    if (existingCpes.length > 0) {
      setProposalCpes(
        existingCpes.map(cpe => {
          const consumoAnual = cpe.consumo_anual?.toString() || '';
          const margem = cpe.margem?.toString() || '';
          
          // Recalculate commission using current tier rules (runtime derivation)
          let comissao = cpe.comissao?.toString() || '';
          if (hasEnergyConfigRef.current && margem) {
            const margemNum = parseFloat(margem);
            if (margemNum > 0) {
              const calc = calcRef.current(margemNum, getVolumeTier(parseFloat(consumoAnual) || 0));
              if (calc !== null) comissao = calc.toFixed(2);
            }
          }
          
          return {
            id: cpe.id,
            existing_cpe_id: cpe.existing_cpe_id,
            equipment_type: cpe.equipment_type,
            serial_number: cpe.serial_number || '',
            comercializador: cpe.comercializador,
            fidelizacao_start: cpe.fidelizacao_start || '',
            fidelizacao_end: cpe.fidelizacao_end || '',
            notes: cpe.notes || '',
            isNew: !cpe.existing_cpe_id,
            consumo_anual: consumoAnual,
            duracao_contrato: cpe.duracao_contrato?.toString() || '',
            dbl: cpe.dbl?.toString() || '',
            margem,
            comissao,
            contrato_inicio: cpe.contrato_inicio || '',
            contrato_fim: cpe.contrato_fim || '',
          };
        })
      );
    } else {
      setProposalCpes([]);
    }
    cpesHydratedFor.current = proposal.id;
  }, [open, existingCpes, cpesLoaded, cpesFetching, proposal.id]);

  const getProductTotal = (product: typeof selectedProducts[0]) => {
    const subtotal = product.quantity * product.unit_price;
    if (product.discount_type === 'percentage') {
      return subtotal * (1 - product.discount_value / 100);
    }
    return Math.max(0, subtotal - product.discount_value);
  };

  const totalComissao = useMemo(() => {
    if (proposalType === 'energia') {
      return proposalCpes.reduce((sum, cpe) => sum + (parseFloat(cpe.comissao) || 0), 0);
    }
    return servicosProdutos.reduce((sum, p) => sum + (servicosDetails[p]?.comissao || 0), 0);
  }, [proposalType, proposalCpes, servicosProdutos, servicosDetails]);

  const legacyWithoutProducts = !isTelecom && productsLoaded && !productsFetching
    && existingProducts.length === 0 && Number(proposal.total_value) > 0;
  const parsedManualTotal = Number(manualTotal.replace(',', '.'));
  const relatedDataReady = isTelecom
    ? cpesLoaded && !cpesFetching && !cpesError && cpesHydratedFor.current === proposal.id
    : productsLoaded && !productsFetching && !productsError
      && productsHydratedFor.current === proposal.id;

  const totalValue = useMemo(() => {
    if (isTelecom) {
      if (proposalType === 'energia') {
        return proposalCpes.reduce((sum, cpe) => sum + (parseFloat(cpe.margem) || 0), 0);
      }
      return totalComissao;
    }
    if (selectedProducts.length > 0) return selectedProducts.reduce((sum, p) => sum + getProductTotal(p), 0);
    return legacyWithoutProducts && Number.isFinite(parsedManualTotal) ? parsedManualTotal : 0;
  }, [isTelecom, proposalType, proposalCpes, totalComissao, selectedProducts, legacyWithoutProducts, parsedManualTotal]);

  const handleClientCreated = (newClientId: string) => {
    setSelectedClientId(newClientId);
  };

  const handleProposalTypeChange = (nextType: ProposalType) => {
    setProposalType(nextType);

    if (nextType === 'energia') {
      setServicosProdutos([]);
      setServicosDetails({});
      setModeloServico('transacional');
      setKwp('');
      setServicosComissao('');
      return;
    }

    setProposalCpes([]);
  };

  const handleServicosProdutoToggle = (produto: string) => {
    if (servicosProdutos.includes(produto)) {
      setServicosProdutos(prev => prev.filter(p => p !== produto));
      setServicosDetails(d => { const n = { ...d }; delete n[produto]; return n; });
    } else {
      setServicosProdutos(prev => [...prev, produto]);
      if (isNewFormat && catalog) {
        const catProduct = catalog.find(c => c.name === produto);
        if (catProduct) {
          const comissao = getCatalogCommission(catProduct);
          setServicosDetails(d => ({
            ...d,
            [produto]: {
              name: catProduct.name,
              price: catProduct.price,
              commission_pct: catProduct.commission_pct,
              commission_type: catProduct.commission_type ?? 'pct',
              commission_fixed: catProduct.commission_fixed ?? 0,
              comissao,
            },
          }));
        }
      }
    }
  };

  const handleSetProductDetail = (produto: string, detail: import('@/types/proposals').ServicosProductDetail) => {
    setServicosDetails(prev => ({ ...prev, [produto]: detail }));
  };

  const handleUpdateProductDetail = (produto: string, field: string, value: number | undefined) => {
    setServicosDetails(prev => {
      const detail = { ...prev[produto], [field]: value };
      const config = SERVICOS_PRODUCT_CONFIGS.find(c => c.name === produto);
      if (config?.kwpAuto && field !== 'kwp') {
        const autoKwp = config.kwpAuto(detail);
        if (autoKwp !== null) detail.kwp = Math.round(autoKwp * 100) / 100;
      }
      // Auto-calc comissao via matrix
      if (field !== 'comissao') {
        const calc = calculateCommission(produto, detail, modeloServico);
        if (calc !== null) detail.comissao = Math.round(calc * 100) / 100;
      }
      return { ...prev, [produto]: detail };
    });
  };

  // Recalculate commissions when modeloServico changes (Transacional <-> SAAS)
  useEffect(() => {
    if (proposalType !== 'servicos' || servicosProdutos.length === 0) return;
    setServicosDetails(prev => {
      const updated = { ...prev };
      for (const prodName of servicosProdutos) {
        const detail = { ...updated[prodName] };
        const config = SERVICOS_PRODUCT_CONFIGS.find(c => c.name === prodName);
        if (config?.kwpAuto) {
          const autoKwp = config.kwpAuto(detail);
          if (autoKwp !== null) detail.kwp = Math.round(autoKwp * 100) / 100;
        }
        const calc = calculateCommission(prodName, detail, modeloServico);
        if (calc !== null) detail.comissao = Math.round(calc * 100) / 100;
        updated[prodName] = detail;
      }
      return updated;
    });
  }, [modeloServico]);

  const totalKwp = useMemo(() => {
    return Object.values(servicosDetails).reduce((sum, d) => sum + (d.kwp || 0), 0);
  }, [servicosDetails]);

  const isServicosValid = useMemo(() => {
    if (!isTelecom || proposalType !== 'servicos') return true;
    if (servicosProdutos.length === 0) return false;
    return servicosProdutos.every(produto => {
      const config = SERVICOS_PRODUCT_CONFIGS.find(c => c.name === produto);
      const detail = servicosDetails[produto] || {};
      return config?.fields.every(field => 
        detail[field] !== undefined && detail[field] > 0
      ) ?? false;
    });
  }, [isTelecom, proposalType, servicosProdutos, servicosDetails]);

  const hasGenericValue = isTelecom || selectedProducts.length > 0
    || (legacyWithoutProducts && Number.isFinite(parsedManualTotal) && parsedManualTotal > 0);
  const isFormValid = relatedDataReady && isServicosValid && hasGenericValue && !!selectedClientId;

  const handleAddProduct = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    const existing = selectedProducts.find(p => p.product_id === productId);
    if (existing) {
      setSelectedProducts(prev => 
        prev.map(p => p.product_id === productId ? { ...p, quantity: p.quantity + 1 } : p)
      );
    } else {
      setSelectedProducts(prev => [...prev, {
        product_id: product.id,
        name: product.name,
        quantity: 1,
        unit_price: product.price || 0,
        discount_type: 'percentage' as const,
        discount_value: 0,
      }]);
    }
  };

  const handleUpdateProductPrice = (productId: string, price: number) => {
    setSelectedProducts(prev => 
      prev.map(p => p.product_id === productId ? { ...p, unit_price: price } : p)
    );
  };

  const handleUpdateProductDiscount = (
    productId: string, 
    discountType: 'percentage' | 'fixed', 
    discountValue: number
  ) => {
    setSelectedProducts(prev => 
      prev.map(p => p.product_id === productId 
        ? { ...p, discount_type: discountType, discount_value: discountValue } 
        : p
      )
    );
  };

  const handleRemoveProduct = (productId: string) => {
    setSelectedProducts(prev => prev.filter(p => p.product_id !== productId));
  };

  const handleUpdateProductQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveProduct(productId);
      return;
    }
    setSelectedProducts(prev => 
      prev.map(p => p.product_id === productId ? { ...p, quantity } : p)
    );
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!isFormValid) return;

    if (isTelecom && proposalType === 'servicos') {
      await updateProposalCpes.mutateAsync({
        proposalId: proposal.id,
        cpes: [],
      });
    }

    await updateProposal.mutateAsync({
      id: proposal.id,
      client_id: selectedClientId || null,
      total_value: totalValue,
      status: status,
      notes: notes.trim() || null,
      proposal_date: proposalDate,
      ...(isTelecom ? {
        proposal_type: proposalType,
        negotiation_type: negotiationType,
        consumo_anual: null,
        margem: null,
        dbl: null,
        anos_contrato: null,
        modelo_servico: proposalType === 'servicos' ? modeloServico : null,
        kwp: proposalType === 'servicos' ? (totalKwp || null) : null,
        comissao: proposalType === 'servicos' ? (totalComissao || null) : null,
        servicos_produtos: proposalType === 'servicos' ? servicosProdutos : null,
        servicos_details: proposalType === 'servicos' && Object.keys(servicosDetails).length > 0 ? servicosDetails : null,
        documents_checked: documentsChecked,
        contract_signed: contractSigned,
      } : {}),
    });

    if (isTelecom && proposalType === 'energia') {
      await updateProposalCpes.mutateAsync({
        proposalId: proposal.id,
        cpes: proposalCpes.map(cpe => ({
          proposal_id: proposal.id,
          existing_cpe_id: cpe.existing_cpe_id || null,
          equipment_type: cpe.equipment_type,
          serial_number: cpe.serial_number || null,
          comercializador: cpe.comercializador,
          fidelizacao_start: cpe.fidelizacao_start || null,
          fidelizacao_end: cpe.fidelizacao_end || null,
          notes: cpe.notes || null,
          consumo_anual: cpe.consumo_anual ? parseFloat(cpe.consumo_anual) : null,
          duracao_contrato: cpe.duracao_contrato ? parseInt(cpe.duracao_contrato) : null,
          dbl: cpe.dbl ? parseFloat(cpe.dbl) : null,
          margem: cpe.margem ? parseFloat(cpe.margem) : null,
          comissao: cpe.comissao ? parseFloat(cpe.comissao) : null,
          contrato_inicio: cpe.contrato_inicio || null,
          contrato_fim: cpe.contrato_fim || null,
        })),
      });
    }

    if (!isTelecom && (selectedProducts.length > 0 || !legacyWithoutProducts)) {
      await updateProposalProducts.mutateAsync({
        proposalId: proposal.id,
        products: selectedProducts.map(p => ({
          product_id: p.product_id,
          quantity: p.quantity,
          unit_price: p.unit_price,
          total: getProductTotal(p),
        })),
      });
    }

    onOpenChange(false);
    onSuccess?.();
  };

  const isSubmitting = updateProposal.isPending || updateProposalCpes.isPending || updateProposalProducts.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pr-14 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Editar Proposta {proposal.code}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto p-4 sm:p-6">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* LEFT COLUMN (60%) */}
                <div className="lg:col-span-3 space-y-4">
                  {/* Info Básica */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <User className="h-4 w-4" />
                        Informação Básica
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-4">
                      <div className="space-y-2">
                        <Label>Cliente</Label>
                        <div className="flex gap-2">
                          <SearchableCombobox
                            options={clients.map((c): ComboboxOption => ({
                              value: c.id,
                              label: c.name,
                              sublabel: c.code || c.email || undefined,
                            }))}
                            value={selectedClientId}
                            onValueChange={setSelectedClientId}
                            placeholder="Selecionar cliente..."
                            searchPlaceholder="Pesquisar cliente..."
                            emptyLabel="Sem cliente associado"
                            emptyText="Nenhum cliente encontrado."
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setIsCreateClientOpen(true)}
                            title="Novo Cliente"
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="proposal-date">Data da Proposta</Label>
                          <Input
                            id="proposal-date"
                            type="date"
                            value={proposalDate}
                            onChange={(e) => setProposalDate(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="status">Estado</Label>
                          <Select value={status} onValueChange={(v) => setStatus(v as ProposalStatus)}>
                            <SelectTrigger id="status">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PROPOSAL_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {PROPOSAL_STATUS_LABELS[s]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Tipo de Negociação - Apenas Telecom */}
                  {isTelecom && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Tipo de Negociação</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="grid grid-cols-2 gap-2">
                          {NEGOTIATION_TYPES.map((type) => (
                            <Button
                              key={type}
                              type="button"
                              variant={negotiationType === type ? 'default' : 'outline'}
                              size="sm"
                              className="text-xs"
                              onClick={() => setNegotiationType(type)}
                            >
                              {NEGOTIATION_TYPE_LABELS[type]}
                            </Button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Tipo de Proposta - Apenas Telecom */}
                  {showEnergy && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Tipo de Proposta</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant={proposalType === 'energia' ? 'default' : 'outline'}
                            className="flex items-center justify-center gap-2 h-10"
                            onClick={() => handleProposalTypeChange('energia')}
                          >
                            <Zap className="h-4 w-4" />
                            Energia
                          </Button>
                          <Button
                            type="button"
                            variant={proposalType === 'servicos' ? 'default' : 'outline'}
                            className="flex items-center justify-center gap-2 h-10"
                            onClick={() => handleProposalTypeChange('servicos')}
                          >
                            <Wrench className="h-4 w-4" />
                            Outros Serviços
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* CPE Selector para propostas de Energia - Apenas Telecom */}
                  {showEnergy && proposalType === 'energia' && (
                    <Card>
                      <CardContent className="p-4">
                        <ProposalCpeSelector
                          clientId={selectedClientId}
                          cpes={proposalCpes}
                          onCpesChange={setProposalCpes}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {/* Campos específicos de Serviços - Apenas Telecom */}
                  {isTelecom && proposalType === 'servicos' && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="space-y-4 p-4 rounded-lg border bg-secondary/30 border-border">
                          <div className="flex items-center gap-2 text-foreground">
                            <Wrench className="h-4 w-4" />
                            <span className="font-medium text-sm">Outros Serviços</span>
                          </div>

                          {/* Modelo de Serviço PRIMEIRO */}
                          <div className="space-y-2">
                            <Label className="text-xs">Modelo de Serviço</Label>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                variant={modeloServico === 'transacional' ? 'default' : 'outline'}
                                size="sm"
                                className="h-9"
                                onClick={() => setModeloServico('transacional')}
                              >
                                Transacional
                              </Button>
                              <Button
                                type="button"
                                variant={modeloServico === 'saas' ? 'default' : 'outline'}
                                size="sm"
                                className="h-9"
                                onClick={() => setModeloServico('saas')}
                              >
                                SAAS
                              </Button>
                            </div>
                          </div>

                          {/* Produtos em linha */}
                          <div className="space-y-3">
                            <Label className="text-xs">Produtos</Label>
                            {SERVICOS_PRODUCT_CONFIGS.map((config) => {
                              const isActive = servicosProdutos.includes(config.name);
                              const detail = servicosDetails[config.name] || {};
                              return (
                                <div key={config.name} className="space-y-2">
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id={`edit-produto-${config.name}`}
                                      checked={isActive}
                                      onCheckedChange={() => handleServicosProdutoToggle(config.name)}
                                    />
                                    <Label htmlFor={`edit-produto-${config.name}`} className="text-sm cursor-pointer font-medium">
                                      {config.name}
                                    </Label>
                                  </div>
                                  {isActive && (
                                    <div className="ml-6 flex flex-wrap gap-2">
                                      {config.fields.map((field) => {
                                        const isComissaoAuto = field === 'comissao' && isAutoCalculated(config.name);
                                        return (
                                        <div key={field} className="space-y-1 min-w-[100px] flex-1">
                                          <Label className="text-xs text-muted-foreground">
                                            {FIELD_LABELS[field]} <span className="text-destructive">*</span>
                                            {isComissaoAuto && <span className="ml-1 text-primary">(auto)</span>}
                                          </Label>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={detail[field] ?? ''}
                                            onChange={(e) => handleUpdateProductDetail(config.name, field, e.target.value ? parseFloat(e.target.value) : undefined)}
                                            placeholder={field === 'kwp' && config.kwpAuto ? 'Auto' : '0'}
                                            className={`h-8 ${attempted && (detail[field] === undefined || detail[field] <= 0) ? 'border-destructive' : ''}`}
                                            readOnly={(field === 'kwp' && !!config.kwpAuto && detail.valor !== undefined) || isComissaoAuto}
                                          />
                                          {attempted && (detail[field] === undefined || detail[field] <= 0) && (
                                            <p className="text-[10px] text-destructive">Obrigatório</p>
                                          )}
                                        </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* kWp Total + Comissão Total */}
                          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">kWp Total</Label>
                              <div className="h-8 flex items-center text-sm font-medium px-3 rounded-md bg-muted">
                                {totalKwp ? totalKwp.toLocaleString('pt-PT', { maximumFractionDigits: 2 }) : '—'}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Comissão Total (€)</Label>
                              <div className="h-8 flex items-center text-sm font-medium px-3 rounded-md bg-muted">
                                {totalComissao ? totalComissao.toLocaleString('pt-PT', { maximumFractionDigits: 2 }) : '—'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Campos para nichos NÃO-telecom */}
                  {!isTelecom && (
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <Package className="h-4 w-4" />
                          Produtos/Serviços
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-3">
                        {productsFetching && !productsLoaded && (
                          <p className="text-sm text-muted-foreground">A carregar os produtos da proposta...</p>
                        )}
                        {productsError && (
                          <p className="text-sm text-destructive">Não foi possível carregar os produtos. Fecha e volta a abrir a proposta antes de guardar.</p>
                        )}
                        {products.length > 0 && (
                          <>
                            <Select onValueChange={handleAddProduct}>
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Adicionar produto/serviço..." />
                              </SelectTrigger>
                              <SelectContent>
                                {products.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.name} {product.price ? `- ${formatCurrency(product.price)}` : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            
                            {selectedProducts.length > 0 && (
                              <div className="space-y-3">
                                {selectedProducts.map((item) => {
                                  const subtotal = item.quantity * item.unit_price;
                                  const discountedTotal = getProductTotal(item);
                                  const hasDiscount = item.discount_value > 0;
                                  
                                  return (
                                    <div key={item.product_id} className="p-3 rounded-lg bg-muted space-y-2">
                                      <div className="flex items-center gap-2">
                                        <Package className="h-4 w-4 text-muted-foreground" />
                                        <span className="flex-1 text-sm font-medium truncate">{item.name}</span>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 p-0"
                                          onClick={() => handleRemoveProduct(item.product_id)}
                                        >
                                          ×
                                        </Button>
                                      </div>
                                      
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <Label className="text-xs text-muted-foreground">Quantidade</Label>
                                          <Input
                                            type="number"
                                            min="0.5"
                                            step="0.5"
                                            value={item.quantity}
                                            onChange={(e) => handleUpdateProductQuantity(item.product_id, parseFloat(e.target.value) || 0)}
                                            className="h-8"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs text-muted-foreground">Preço Unit.</Label>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            value={item.unit_price}
                                            onChange={(e) => handleUpdateProductPrice(item.product_id, parseFloat(e.target.value) || 0)}
                                            className="h-8"
                                          />
                                        </div>
                                      </div>
                                      
                                      <div className="flex items-end gap-2">
                                        <div className="flex-1">
                                          <Label className="text-xs text-muted-foreground">Desconto</Label>
                                          <div className="flex gap-1">
                                            <Button
                                              type="button"
                                              variant={item.discount_type === 'percentage' ? 'default' : 'outline'}
                                              size="sm"
                                              className="h-8 w-10 p-0"
                                              onClick={() => handleUpdateProductDiscount(item.product_id, 'percentage', item.discount_value)}
                                            >
                                              %
                                            </Button>
                                            <Button
                                              type="button"
                                              variant={item.discount_type === 'fixed' ? 'default' : 'outline'}
                                              size="sm"
                                              className="h-8 w-10 p-0"
                                              onClick={() => handleUpdateProductDiscount(item.product_id, 'fixed', item.discount_value)}
                                            >
                                              €
                                            </Button>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              value={item.discount_value || ''}
                                              onChange={(e) => handleUpdateProductDiscount(
                                                item.product_id, 
                                                item.discount_type, 
                                                parseFloat(e.target.value) || 0
                                              )}
                                              className="h-8 flex-1"
                                              placeholder="0"
                                            />
                                          </div>
                                        </div>
                                        <div className="text-right min-w-[70px]">
                                          <Label className="text-xs text-muted-foreground">Subtotal</Label>
                                          <div className="text-sm font-medium">
                                            {hasDiscount && (
                                              <span className="text-xs text-muted-foreground line-through mr-1">
                                                {formatCurrency(subtotal)}
                                              </span>
                                            )}
                                            <span className={hasDiscount ? 'text-green-600' : ''}>
                                              {formatCurrency(discountedTotal)}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                        {legacyWithoutProducts && selectedProducts.length === 0 && (
                          <div className="space-y-2 rounded-lg border border-border p-3">
                            <Label htmlFor="legacy-proposal-total">Valor da proposta (€)</Label>
                            <Input id="legacy-proposal-total" type="number" min="0.01" step="0.01"
                              value={manualTotal} onChange={(event) => setManualTotal(event.target.value)} />
                            <p className="text-xs text-muted-foreground">
                              Esta proposta antiga tem um valor guardado, mas não tem linhas de produtos associadas. Podes manter ou editar o valor, ou adicionar produtos acima.
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Documentos / Contrato (apenas telecom) */}
                  {isTelecom && (
                    <Card>
                      <CardContent className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <DocumentsCheckboxField id="edit-proposal-documents" checked={documentsChecked} onChange={setDocumentsChecked} />
                        <ContractSignedCheckboxField id="edit-proposal-contract" checked={contractSigned} onChange={setContractSigned} />
                      </CardContent>
                    </Card>
                  )}

                  {/* Observações */}
                  <Card>
                    <CardHeader className="pb-2 p-4">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Observações da Negociação</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <Textarea
                        id="notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Detalhes da negociação, condições especiais, etc..."
                        rows={3}
                      />
                    </CardContent>
                  </Card>
                </div>

                {/* RIGHT COLUMN (40%) - Sticky */}
                <div className="lg:col-span-2">
                  <div className="lg:sticky lg:top-6 space-y-4">
                    {/* Resumo */}
                    <Card>
                      <CardHeader className="pb-2 p-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <FileText className="h-4 w-4" />
                          Resumo
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-3">
                        {isTelecom && proposalType === 'energia' && proposalCpes.length > 0 && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">CPE/CUI adicionados</span>
                              <span className="font-medium">{proposalCpes.length}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Comissão Total</span>
                              <span className="font-medium">{formatCurrency(totalComissao)}</span>
                            </div>
                            <Separator />
                          </>
                        )}

                        {!isTelecom && selectedProducts.length > 0 && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Produtos</span>
                              <span className="font-medium">{selectedProducts.length}</span>
                            </div>
                            <Separator />
                          </>
                        )}

                        <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 text-center">
                          <p className="text-sm text-muted-foreground mb-1">Total da Proposta</p>
                          <p className="text-2xl font-bold text-primary">{formatCurrency(relatedDataReady ? totalValue : Number(proposal.total_value) || 0)}</p>
                          {isTelecom && proposalType === 'energia' && proposalCpes.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Soma das margens de {proposalCpes.length} CPE(s)
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Fixed Footer */}
          <div className="p-4 border-t border-border/50 shrink-0">
            <div className="flex gap-3 max-w-6xl mx-auto">
              <Button
                variant="senvia"
                className="flex-1"
                size="lg"
                onClick={handleSubmit}
                disabled={isSubmitting || !relatedDataReady || (attempted && !isFormValid)}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    A guardar...
                  </>
                ) : (
                  "Guardar Alterações"
                )}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                size="lg"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CreateClientModal
        open={isCreateClientOpen}
        onOpenChange={setIsCreateClientOpen}
        onCreated={handleClientCreated}
      />
    </>
  );
}
